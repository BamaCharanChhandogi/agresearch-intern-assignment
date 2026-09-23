import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('Part 1: Tray Endpoints & HTTP Semantics', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });

  it('POST /trays creates a new tray with 201 Created', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: 'T-A-014',
        zone: 'Zone-Alpha',
        capacity_units: 50,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.code).toBe('T-A-014');
    expect(body.zone).toBe('Zone-Alpha');
    expect(body.capacity_units).toBe(50);
  });

  it('POST /trays rejects bad input with 400 Bad Request', async () => {
    // Missing required field 'capacity_units'
    const res1 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: 'T-A-015',
        zone: 'Zone-Alpha',
      },
    });
    expect(res1.statusCode).toBe(400);

    // Negative capacity_units violating minimum: 1
    const res2 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: 'T-A-016',
        zone: 'Zone-Alpha',
        capacity_units: -5,
      },
    });
    expect(res2.statusCode).toBe(400);

    // Extra unknown property with additionalProperties: false
    const res3 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: 'T-A-017',
        zone: 'Zone-Alpha',
        capacity_units: 10,
        unauthorized_field: 'malicious',
      },
    });
    expect(res3.statusCode).toBe(400);
  });

  it('POST /trays rejects duplicate tray codes with 409 Conflict', async () => {
    await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: 'T-DUP-01',
        zone: 'Zone-A',
        capacity_units: 30,
      },
    });

    // Attempt to create second tray with identical code
    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: 'T-DUP-01',
        zone: 'Zone-B',
        capacity_units: 40,
      },
    });

    expect(duplicateRes.statusCode).toBe(409);
    const body = duplicateRes.json();
    expect(body.message).toMatch(/already exists/i);
  });

  it('GET /trays returns list of created trays with 200 OK', async () => {
    const t1 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-LIST-01', zone: 'Zone-A', capacity_units: 20 },
    });
    expect(t1.statusCode).toBe(201);

    const t2 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-LIST-02', zone: 'Zone-B', capacity_units: 30 },
    });
    expect(t2.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: '/trays',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);
    expect(body.data).toHaveLength(2);
  });

  it('GET /trays/:id returns one tray or 404 Not Found', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-GET-01', zone: 'Zone-X', capacity_units: 15 },
    });
    const tray = createRes.json();

    // Existing ID
    const foundRes = await app.inject({
      method: 'GET',
      url: `/trays/${tray.id}`,
    });
    expect(foundRes.statusCode).toBe(200);
    expect(foundRes.json().code).toBe('T-GET-01');

    // Non-existent ID
    const missingRes = await app.inject({
      method: 'GET',
      url: '/trays/00000000-0000-0000-0000-000000000000',
    });
    expect(missingRes.statusCode).toBe(404);
  });

  it('POST /batches rejects seeding into non-existent tray with 404 Not Found', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batches',
      payload: {
        tray_id: '00000000-0000-0000-0000-000000000000',
        crop: 'Butterhead Lettuce',
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/not found/i);
  });
});
