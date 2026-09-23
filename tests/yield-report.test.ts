import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('Part 3c: Yield Reporting (Single SQL Query)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp();

    // Setup 2 trays in distinct zones
    const t1 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-ZONE-A', zone: 'Zone-A', capacity_units: 100 },
    });
    const trayAId = t1.json().id;

    const t2 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-ZONE-B', zone: 'Zone-B', capacity_units: 100 },
    });
    const trayBId = t2.json().id;

    // Helper to seed, advance, and harvest a batch with custom dates
    async function seedAndHarvest(
      trayId: string,
      crop: string,
      seededOn: string,
      harvestedOn: string,
      weightGrams: number,
      grade: 'A' | 'B' | 'C'
    ) {
      const bRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop, seeded_on: seededOn },
      });
      const batchId = bRes.json().id;

      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // HARVEST_READY

      const hRes = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: {
          weight_grams: weightGrams,
          grade,
          harvested_on: harvestedOn,
        },
      });
      expect(hRes.statusCode).toBe(201);
      return batchId;
    }

    // Batch 1: Romaine in Zone-A, 1000g, 20 days (Sep 1 -> Sep 21)
    await seedAndHarvest(trayAId, 'Romaine Lettuce', '2026-09-01', '2026-09-21', 1000.0, 'A');

    // Free trayA was reused for Batch 2: Spinach in Zone-A, 800g, 10 days (Sep 05 -> Sep 15)
    await seedAndHarvest(trayAId, 'Spinach', '2026-09-05', '2026-09-15', 800.0, 'B');

    // Batch 3: Romaine in Zone-B, 500g, 10 days (Sep 01 -> Sep 11)
    await seedAndHarvest(trayBId, 'Romaine Lettuce', '2026-09-01', '2026-09-11', 500.0, 'A');
  });

  it('aggregates yield grouped by crop with exact counts, total weights, and average duration', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/yield?from=2026-09-01&to=2026-09-30&group_by=crop',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);

    const romaine = body.data.find((r: any) => r.group_key === 'Romaine Lettuce');
    expect(romaine).toBeDefined();
    expect(romaine.batches_harvested).toBe(2);
    expect(romaine.total_weight_grams).toBe(1500); // 1000 + 500
    expect(romaine.avg_days_to_harvest).toBe(15); // (20 + 10) / 2

    const spinach = body.data.find((r: any) => r.group_key === 'Spinach');
    expect(spinach).toBeDefined();
    expect(spinach.batches_harvested).toBe(1);
    expect(spinach.total_weight_grams).toBe(800);
    expect(spinach.avg_days_to_harvest).toBe(10);
  });

  it('aggregates yield grouped by zone with exact counts and total weights', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/yield?from=2026-09-01&to=2026-09-30&group_by=zone',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);

    const zoneA = body.data.find((r: any) => r.group_key === 'Zone-A');
    expect(zoneA).toBeDefined();
    expect(zoneA.batches_harvested).toBe(2); // 1 Romaine + 1 Spinach
    expect(zoneA.total_weight_grams).toBe(1800); // 1000 + 800
    expect(zoneA.avg_days_to_harvest).toBe(15); // (20 + 10) / 2

    const zoneB = body.data.find((r: any) => r.group_key === 'Zone-B');
    expect(zoneB).toBeDefined();
    expect(zoneB.batches_harvested).toBe(1);
    expect(zoneB.total_weight_grams).toBe(500);
    expect(zoneB.avg_days_to_harvest).toBe(10);
  });

  it('rejects invalid date range where from > to with 400 Bad Request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/yield?from=2026-09-30&to=2026-09-01&group_by=crop',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/cannot be after 'to'/i);
  });

  it('rejects invalid group_by parameter with 400 Bad Request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/yield?from=2026-09-01&to=2026-09-30&group_by=invalid_dimension',
    });

    expect(res.statusCode).toBe(400);
  });
});
