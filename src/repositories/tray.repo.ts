import { query } from '../db/pool.js';
import { Tray } from '../types.js';

export interface ITrayRepository {
  create(data: { code: string; zone: string; capacity_units: number }): Promise<Tray>;
  findAll(): Promise<Tray[]>;
  findById(id: string): Promise<Tray | null>;
  findByCode(code: string): Promise<Tray | null>;
}

export class PostgresTrayRepository implements ITrayRepository {
  async create(data: { code: string; zone: string; capacity_units: number }): Promise<Tray> {
    const text = `
      INSERT INTO trays (code, zone, capacity_units)
      VALUES ($1, $2, $3)
      RETURNING id, code, zone, capacity_units, created_at;
    `;
    const res = await query<Tray>(text, [data.code, data.zone, data.capacity_units]);
    return res.rows[0];
  }

  async findAll(): Promise<Tray[]> {
    const text = `
      SELECT id, code, zone, capacity_units, created_at
      FROM trays
      ORDER BY created_at DESC;
    `;
    const res = await query<Tray>(text);
    return res.rows;
  }

  async findById(id: string): Promise<Tray | null> {
    const text = `
      SELECT id, code, zone, capacity_units, created_at
      FROM trays
      WHERE id = $1;
    `;
    const res = await query<Tray>(text, [id]);
    return res.rows[0] || null;
  }

  async findByCode(code: string): Promise<Tray | null> {
    const text = `
      SELECT id, code, zone, capacity_units, created_at
      FROM trays
      WHERE code = $1;
    `;
    const res = await query<Tray>(text, [code]);
    return res.rows[0] || null;
  }
}

export const trayRepository = new PostgresTrayRepository();
