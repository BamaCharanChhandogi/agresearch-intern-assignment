import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('Part 2: Business Rules & Batch Lifecycle', () => {
  let app: FastifyInstance;
  let trayId: string;

  beforeEach(async () => {
    app = buildApp();

    // Create a fresh tray for each test
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: `T-TEST-${Math.random().toString(36).substring(7)}`,
        zone: 'Zone-North',
        capacity_units: 100,
      },
    });
    expect(trayRes.statusCode).toBe(201);
    trayId = trayRes.json().id;
  });

  // =========================================================================
  // Business Rule 1: A tray can hold at most one active batch.
  // A batch is active until it reaches HARVESTED.
  // =========================================================================
  describe('Business Rule 1: Tray Occupancy', () => {
    it('allows seeding a batch into an empty tray', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Romaine Lettuce',
        },
      });

      expect(res.statusCode).toBe(201);
      const batch = res.json();
      expect(batch.tray_id).toBe(trayId);
      expect(batch.stage).toBe('SEEDED');
      expect(batch.crop).toBe('Romaine Lettuce');
    });

    it('rejects seeding a second batch into an occupied tray with 409 Conflict', async () => {
      // 1. Seed first batch
      const firstRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Romaine Lettuce' },
      });
      expect(firstRes.statusCode).toBe(201);

      // 2. Attempt second batch into the same tray while first is active
      const secondRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Baby Spinach' },
      });

      expect(secondRes.statusCode).toBe(409);
      expect(secondRes.json().message).toMatch(/already occupied/i);
    });

    it('tray remains occupied across non-harvested stages (GERMINATION, GROWING, HARVEST_READY)', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Romaine Lettuce' },
      });
      const batchId = seedRes.json().id;

      // Advance to GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });

      // Still cannot seed another batch
      const fail1 = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Kale' },
      });
      expect(fail1.statusCode).toBe(409);

      // Advance to GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });

      // Still cannot seed another batch
      const fail2 = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Kale' },
      });
      expect(fail2.statusCode).toBe(409);

      // Advance to HARVEST_READY
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });

      // Still cannot seed another batch until harvested
      const fail3 = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Kale' },
      });
      expect(fail3.statusCode).toBe(409);
    });
  });

  // =========================================================================
  // Business Rule 2: Stage transitions only move forward, and only one step
  // at a time. You cannot skip GROWING, and you cannot go back.
  // =========================================================================
  describe('Business Rule 2: Strict Forward Stage Progression', () => {
    it('advances forward one step at a time: SEEDED -> GERMINATION -> GROWING -> HARVEST_READY', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Arugula' },
      });
      const batchId = seedRes.json().id;
      expect(seedRes.json().stage).toBe('SEEDED');

      // 1. SEEDED -> GERMINATION
      const step1 = await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      expect(step1.statusCode).toBe(200);
      expect(step1.json().stage).toBe('GERMINATION');

      // 2. GERMINATION -> GROWING
      const step2 = await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      expect(step2.statusCode).toBe(200);
      expect(step2.json().stage).toBe('GROWING');

      // 3. GROWING -> HARVEST_READY
      const step3 = await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      expect(step3.statusCode).toBe(200);
      expect(step3.json().stage).toBe('HARVEST_READY');
    });

    it('rejects skipping a stage (e.g. SEEDED directly to GROWING)', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Arugula' },
      });
      const batchId = seedRes.json().id;

      // Attempt to skip GERMINATION directly to GROWING
      const skipRes = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
        payload: { target_stage: 'GROWING' },
      });

      expect(skipRes.statusCode).toBe(400);
      expect(skipRes.json().message).toMatch(/cannot move from 'SEEDED' to 'GROWING'/i);
    });

    it('rejects moving backwards (e.g. GROWING to GERMINATION or SEEDED)', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Arugula' },
      });
      const batchId = seedRes.json().id;

      // Advance to GERMINATION then GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });

      // Attempt backwards to GERMINATION
      const backwardRes = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
        payload: { target_stage: 'GERMINATION' },
      });

      expect(backwardRes.statusCode).toBe(400);
      expect(backwardRes.json().message).toMatch(/invalid stage transition/i);
    });

    it('rejects advancing HARVEST_READY via PATCH stage (must use harvest endpoint)', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Arugula' },
      });
      const batchId = seedRes.json().id;

      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // HARVEST_READY

      // Attempt to advance stage from HARVEST_READY
      const res = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/harvest must be recorded/i);
    });
  });

  // =========================================================================
  // Business Rule 3 & 4: Harvest Constraints & Tray Release
  // =========================================================================
  describe('Business Rule 3 & 4: Harvest Recording & Tray Release', () => {
    it('Rule 3: rejects harvest if batch is in SEEDED, GERMINATION, or GROWING', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Swiss Chard' },
      });
      const batchId = seedRes.json().id;

      // Try harvest on SEEDED
      const failSeeded = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: { weight_grams: 450.5, grade: 'A' },
      });
      expect(failSeeded.statusCode).toBe(409);
      expect(failSeeded.json().message).toMatch(/SEEDED/i);
      expect(failSeeded.json().message).toMatch(/HARVEST_READY/i);

      // Advance to GERMINATION and try
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      const failGerm = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: { weight_grams: 450.5, grade: 'A' },
      });
      expect(failGerm.statusCode).toBe(409);

      // Advance to GROWING and try
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      const failGrow = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: { weight_grams: 450.5, grade: 'A' },
      });
      expect(failGrow.statusCode).toBe(409);
    });

    it('Rule 4: recording harvest moves batch to HARVESTED and frees tray for reuse', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Swiss Chard' },
      });
      const batchId = seedRes.json().id;

      // Walk through to HARVEST_READY
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // HARVEST_READY

      // Record harvest
      const harvestRes = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: { weight_grams: 620.0, grade: 'A' },
      });

      expect(harvestRes.statusCode).toBe(201);
      const harvest = harvestRes.json();
      expect(harvest.batch_id).toBe(batchId);
      expect(harvest.weight_grams).toBe(620.0);
      expect(harvest.grade).toBe('A');

      // Verify batch is now in HARVESTED stage
      const batchCheck = await app.inject({
        method: 'GET',
        url: `/batches/${batchId}`,
      });
      expect(batchCheck.json().stage).toBe('HARVESTED');

      // CRITICAL CHECK: Tray is now FREED for reuse!
      const newSeedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Fresh Kale' },
      });

      expect(newSeedRes.statusCode).toBe(201);
      expect(newSeedRes.json().crop).toBe('Fresh Kale');
      expect(newSeedRes.json().tray_id).toBe(trayId);
    });

    it('rejects duplicate harvest of an already HARVESTED batch with 409 Conflict', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Butterhead Lettuce' },
      });
      const batchId = seedRes.json().id;

      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });

      // First harvest
      const h1 = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: { weight_grams: 500, grade: 'B' },
      });
      expect(h1.statusCode).toBe(201);

      // Attempt second harvest without idempotency key
      const h2 = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: { weight_grams: 500, grade: 'B' },
      });
      expect(h2.statusCode).toBe(409);
      expect(h2.json().message).toMatch(/already.*harvested/i);
    });
  });

  // =========================================================================
  // Filtering & Pagination
  // =========================================================================
  describe('GET /batches: Filtering & Pagination', () => {
    it('filters batches by stage, crop, and zone with pagination', async () => {
      // Create second tray in Zone-South
      const tray2Res = await app.inject({
        method: 'POST',
        url: '/trays',
        payload: { code: 'T-SOUTH-01', zone: 'Zone-South', capacity_units: 50 },
      });
      const tray2Id = tray2Res.json().id;

      // Seed batches
      const b1 = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: trayId, crop: 'Red Romaine' },
      });
      const b2 = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: tray2Id, crop: 'Bok Choy' },
      });

      // Filter by crop
      const cropFilter = await app.inject({
        method: 'GET',
        url: '/batches?crop=Romaine',
      });
      expect(cropFilter.statusCode).toBe(200);
      expect(cropFilter.json().data).toHaveLength(1);
      expect(cropFilter.json().data[0].crop).toBe('Red Romaine');

      // Filter by zone (via join to trays)
      const zoneFilter = await app.inject({
        method: 'GET',
        url: '/batches?zone=South',
      });
      expect(zoneFilter.statusCode).toBe(200);
      expect(zoneFilter.json().data).toHaveLength(1);
      expect(zoneFilter.json().data[0].crop).toBe('Bok Choy');

      // Pagination
      const pageRes = await app.inject({
        method: 'GET',
        url: '/batches?page=1&limit=1',
      });
      expect(pageRes.statusCode).toBe(200);
      expect(pageRes.json().data).toHaveLength(1);
      expect(pageRes.json().pagination.total).toBe(2);
      expect(pageRes.json().pagination.totalPages).toBe(2);
    });
  });
});
