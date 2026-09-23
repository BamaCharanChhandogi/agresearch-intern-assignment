import { getPool } from '../db/pool.js';
import { Harvest, HarvestGrade } from '../types.js';
import { ConflictError, NotFoundError } from '../errors.js';

export interface IHarvestRepository {
  createHarvestAndCloseBatch(data: {
    batch_id: string;
    weight_grams: number;
    grade: HarvestGrade;
    harvested_on?: string;
  }): Promise<Harvest>;
  findByBatchId(batchId: string): Promise<Harvest | null>;
}

function normalizeDate(d: any): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function mapRowToHarvest(row: any): Harvest {
  return {
    id: row.id,
    batch_id: row.batch_id,
    harvested_on: normalizeDate(row.harvested_on),
    weight_grams: Number(row.weight_grams),
    grade: row.grade,
    created_at: row.created_at,
  };
}

export class PostgresHarvestRepository implements IHarvestRepository {
  async createHarvestAndCloseBatch(data: {
    batch_id: string;
    weight_grams: number;
    grade: HarvestGrade;
    harvested_on?: string;
  }): Promise<Harvest> {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Lock the batch row for update to ensure concurrency safety
      const batchRes = await client.query(
        `SELECT id, stage FROM batches WHERE id = $1 FOR UPDATE`,
        [data.batch_id]
      );

      if (batchRes.rows.length === 0) {
        throw new NotFoundError(`Batch with ID '${data.batch_id}' was not found.`);
      }

      const batch = batchRes.rows[0];

      // 2. Business Rule: "A harvest can only be recorded for a batch in HARVEST_READY."
      if (batch.stage !== 'HARVEST_READY') {
        if (batch.stage === 'HARVESTED') {
          throw new ConflictError(`Batch '${data.batch_id}' has already been harvested.`);
        }
        throw new ConflictError(
          `Cannot record harvest: batch is currently in '${batch.stage}', but must be in 'HARVEST_READY'.`
        );
      }

      // 3. Insert harvest record
      const insertSql = `
        INSERT INTO harvests (batch_id, weight_grams, grade, harvested_on)
        VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))
        RETURNING id, batch_id, harvested_on, weight_grams, grade, created_at;
      `;
      const harvestRes = await client.query(insertSql, [
        data.batch_id,
        data.weight_grams,
        data.grade,
        data.harvested_on || null,
      ]);

      // 4. Business Rule: "Recording a harvest moves the batch to HARVESTED and frees the tray for reuse."
      await client.query(
        `UPDATE batches SET stage = 'HARVESTED' WHERE id = $1`,
        [data.batch_id]
      );

      await client.query('COMMIT');
      return mapRowToHarvest(harvestRes.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByBatchId(batchId: string): Promise<Harvest | null> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, batch_id, harvested_on, weight_grams, grade, created_at
       FROM harvests
       WHERE batch_id = $1`,
      [batchId]
    );
    return res.rows[0] ? mapRowToHarvest(res.rows[0]) : null;
  }
}

export const harvestRepository = new PostgresHarvestRepository();
