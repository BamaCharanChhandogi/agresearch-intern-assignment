import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('Part 3a: Concurrency Safety', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });

  it('guarantees that when multiple requests attempt to seed the same tray simultaneously, exactly ONE succeeds and all others fail cleanly with 409 Conflict', async () => {
    // 1. Create a physical tray T-A-014 as described in the spec
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: 'T-A-014',
        zone: 'Zone-A',
        capacity_units: 75,
      },
    });
    expect(trayRes.statusCode).toBe(201);
    const trayId = trayRes.json().id;

    // 2. Fire 10 genuinely concurrent seeding requests at the exact same instant using Promise.all
    const CONCURRENT_REQUESTS = 10;
    const seedPromises = Array.from({ length: CONCURRENT_REQUESTS }, (_, index) =>
      app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: `Batch-Candidate-${index}`,
        },
      })
    );

    const responses = await Promise.all(seedPromises);

    // 3. Exactly ONE request must succeed (201 Created)
    const successfulResponses = responses.filter((r) => r.statusCode === 201);
    expect(successfulResponses).toHaveLength(1);

    // 4. All remaining 9 requests must fail cleanly with 409 Conflict
    const conflictResponses = responses.filter((r) => r.statusCode === 409);
    expect(conflictResponses).toHaveLength(CONCURRENT_REQUESTS - 1);

    for (const r of conflictResponses) {
      expect(r.json().message).toMatch(/already occupied/i);
    }

    // 5. Verify the database state: exactly ONE active batch exists in tray T-A-014
    const listRes = await app.inject({
      method: 'GET',
      url: `/batches`,
    });
    expect(listRes.statusCode).toBe(200);
    const batchesInTray = listRes.json().data.filter((b: any) => b.tray_id === trayId);
    expect(batchesInTray).toHaveLength(1);
    expect(batchesInTray[0].stage).toBe('SEEDED');
  });
});
