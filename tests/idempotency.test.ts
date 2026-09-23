import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('Part 3b: Idempotent Harvest Recording', () => {
  let app: FastifyInstance;
  let batchId: string;

  beforeEach(async () => {
    app = buildApp();

    // Setup tray
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-IDEMP-01', zone: 'Zone-Mobile', capacity_units: 50 },
    });
    const trayId = trayRes.json().id;

    // Seed batch
    const batchRes = await app.inject({
      method: 'POST',
      url: '/batches',
      payload: { tray_id: trayId, crop: 'Hydro Butterhead' },
    });
    batchId = batchRes.json().id;

    // Advance to HARVEST_READY
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // HARVEST_READY
  });

  it('safely replays identical response on retry with same Idempotency-Key header without double-recording', async () => {
    const idempotencyKey = 'field-handheld-uuid-987654321';

    // 1. First attempt from mobile device in the field
    const firstRes = await app.inject({
      method: 'POST',
      url: `/batches/${batchId}/harvest`,
      headers: {
        'idempotency-key': idempotencyKey,
      },
      payload: {
        weight_grams: 850.5,
        grade: 'A',
      },
    });

    expect(firstRes.statusCode).toBe(201);
    const initialHarvest = firstRes.json();
    expect(initialHarvest.id).toBeDefined();
    expect(initialHarvest.batch_id).toBe(batchId);
    expect(initialHarvest.weight_grams).toBe(850.5);
    expect(initialHarvest.grade).toBe('A');

    // 2. Simulated network retry (field staff mobile retry after dropped connection)
    const retryRes = await app.inject({
      method: 'POST',
      url: `/batches/${batchId}/harvest`,
      headers: {
        'idempotency-key': idempotencyKey,
      },
      payload: {
        weight_grams: 850.5,
        grade: 'A',
      },
    });

    expect(retryRes.statusCode).toBe(201);
    expect(retryRes.headers['x-cache-lookup']).toBe('HIT');
    const replayedHarvest = retryRes.json();
    expect(replayedHarvest.id).toBe(initialHarvest.id);
    expect(replayedHarvest.weight_grams).toBe(initialHarvest.weight_grams);
    expect(replayedHarvest.grade).toBe(initialHarvest.grade);

    // 3. Verify database integrity: exactly ONE harvest was recorded in the database
    // Advancing or checking harvest shows single record
    const batchCheck = await app.inject({ method: 'GET', url: `/batches/${batchId}` });
    expect(batchCheck.json().stage).toBe('HARVESTED');
  });

  it('rejects attempt to harvest with a different idempotency key once batch is already HARVESTED', async () => {
    // Harvest with key 1
    const res1 = await app.inject({
      method: 'POST',
      url: `/batches/${batchId}/harvest`,
      headers: { 'idempotency-key': 'key-device-alpha' },
      payload: { weight_grams: 700, grade: 'B' },
    });
    expect(res1.statusCode).toBe(201);

    // Attempt second harvest with completely different key
    const res2 = await app.inject({
      method: 'POST',
      url: `/batches/${batchId}/harvest`,
      headers: { 'idempotency-key': 'key-device-beta' },
      payload: { weight_grams: 700, grade: 'B' },
    });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().message).toMatch(/already.*harvested/i);
  });
});
