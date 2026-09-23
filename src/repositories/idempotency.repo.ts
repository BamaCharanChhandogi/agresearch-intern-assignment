import { query } from '../db/pool.js';
import { IdempotencyRecord } from '../types.js';

export interface IIdempotencyRepository {
  findByKey(key: string): Promise<IdempotencyRecord | null>;
  save(record: {
    key: string;
    batch_id: string;
    response_status: number;
    response_body: Record<string, any>;
  }): Promise<void>;
}

export class PostgresIdempotencyRepository implements IIdempotencyRepository {
  async findByKey(key: string): Promise<IdempotencyRecord | null> {
    const text = `
      SELECT key, batch_id, response_status, response_body, created_at, expires_at
      FROM idempotency_keys
      WHERE key = $1 AND expires_at > now();
    `;
    const res = await query<IdempotencyRecord>(text, [key]);
    return res.rows[0] || null;
  }

  async save(record: {
    key: string;
    batch_id: string;
    response_status: number;
    response_body: Record<string, any>;
  }): Promise<void> {
    const text = `
      INSERT INTO idempotency_keys (key, batch_id, response_status, response_body)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE
      SET response_status = EXCLUDED.response_status,
          response_body = EXCLUDED.response_body;
    `;
    await query(text, [
      record.key,
      record.batch_id,
      record.response_status,
      JSON.stringify(record.response_body),
    ]);
  }
}

export const idempotencyRepository = new PostgresIdempotencyRepository();
