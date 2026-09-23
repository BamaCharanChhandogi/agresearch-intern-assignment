import { query } from '../db/pool.js';
import { Batch, BatchStage } from '../types.js';

export interface BatchFilter {
  stage?: BatchStage;
  crop?: string;
  zone?: string;
  limit: number;
  offset: number;
}

export interface IBatchRepository {
  create(data: {
    tray_id: string;
    crop: string;
    seeded_on?: string;
    expected_harvest_on?: string | null;
  }): Promise<Batch>;
  findById(id: string): Promise<Batch | null>;
  findActiveByTrayId(tray_id: string): Promise<Batch | null>;
  updateStage(id: string, stage: BatchStage): Promise<Batch | null>;
  findAll(filter: BatchFilter): Promise<{ batches: Batch[]; total: number }>;
}

function normalizeDate(d: any): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function mapRowToBatch(row: any): Batch {
  return {
    id: row.id,
    tray_id: row.tray_id,
    crop: row.crop,
    seeded_on: normalizeDate(row.seeded_on) || new Date().toISOString().slice(0, 10),
    stage: row.stage,
    expected_harvest_on: normalizeDate(row.expected_harvest_on),
    created_at: row.created_at,
    tray_code: row.tray_code,
    zone: row.zone,
  };
}

export class PostgresBatchRepository implements IBatchRepository {
  async create(data: {
    tray_id: string;
    crop: string;
    seeded_on?: string;
    expected_harvest_on?: string | null;
  }): Promise<Batch> {
    const text = `
      INSERT INTO batches (tray_id, crop, seeded_on, expected_harvest_on)
      VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4::date)
      RETURNING id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at;
    `;
    const res = await query(text, [
      data.tray_id,
      data.crop,
      data.seeded_on || null,
      data.expected_harvest_on || null,
    ]);
    return mapRowToBatch(res.rows[0]);
  }

  async findById(id: string): Promise<Batch | null> {
    const text = `
      SELECT b.id, b.tray_id, b.crop, b.seeded_on, b.stage, b.expected_harvest_on, b.created_at,
             t.code AS tray_code, t.zone
      FROM batches b
      JOIN trays t ON t.id = b.tray_id
      WHERE b.id = $1;
    `;
    const res = await query(text, [id]);
    return res.rows[0] ? mapRowToBatch(res.rows[0]) : null;
  }

  async findActiveByTrayId(tray_id: string): Promise<Batch | null> {
    const text = `
      SELECT id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at
      FROM batches
      WHERE tray_id = $1 AND stage != 'HARVESTED'
      LIMIT 1;
    `;
    const res = await query(text, [tray_id]);
    return res.rows[0] ? mapRowToBatch(res.rows[0]) : null;
  }

  async updateStage(id: string, stage: BatchStage): Promise<Batch | null> {
    const text = `
      UPDATE batches
      SET stage = $2
      WHERE id = $1
      RETURNING id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at;
    `;
    const res = await query(text, [id, stage]);
    return res.rows[0] ? mapRowToBatch(res.rows[0]) : null;
  }

  async findAll(filter: BatchFilter): Promise<{ batches: Batch[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filter.stage) {
      conditions.push(`b.stage = $${paramIndex++}`);
      params.push(filter.stage);
    }

    if (filter.crop) {
      conditions.push(`b.crop ILIKE $${paramIndex++}`);
      params.push(`%${filter.crop}%`);
    }

    if (filter.zone) {
      conditions.push(`t.zone ILIKE $${paramIndex++}`);
      params.push(`%${filter.zone}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM batches b
      JOIN trays t ON t.id = b.tray_id
      ${whereClause};
    `;
    const countRes = await query<{ total: number }>(countSql, params);
    const total = countRes.rows[0]?.total || 0;

    const dataSql = `
      SELECT b.id, b.tray_id, b.crop, b.seeded_on, b.stage, b.expected_harvest_on, b.created_at,
             t.code AS tray_code, t.zone
      FROM batches b
      JOIN trays t ON t.id = b.tray_id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;
    const dataParams = [...params, filter.limit, filter.offset];
    const dataRes = await query(dataSql, dataParams);

    return {
      batches: dataRes.rows.map(mapRowToBatch),
      total,
    };
  }
}

export const batchRepository = new PostgresBatchRepository();
