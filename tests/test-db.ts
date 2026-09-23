import { newDb, IMemoryDb } from 'pg-mem';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setPool, closePool } from '../src/db/pool.js';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let currentDb: IMemoryDb | null = null;
let currentPool: pg.Pool | null = null;

export async function resetTestDatabase(): Promise<pg.Pool> {
  // If user explicitly configured a real PostgreSQL database for tests:
  if (process.env.TEST_WITH_REAL_PG === 'true' && process.env.DATABASE_URL_TEST) {
    const { getPool } = await import('../src/db/pool.js');
    const pool = getPool(process.env.DATABASE_URL_TEST);
    // Truncate all tables
    await pool.query('TRUNCATE TABLE idempotency_keys, harvests, batches, trays CASCADE');
    return pool;
  }

  // Fast, isolated in-memory PostgreSQL emulator
  currentDb = newDb({
    autoCreateForeignKeyIndices: true,
  });

  // Register standard PostgreSQL functions used in schema
  currentDb.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    implementation: () => {
      // Generate standard RFC4122 v4 UUID
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },
  });

  currentDb.public.registerFunction({
    name: 'round',
    args: [currentDb.public.getType('numeric'), currentDb.public.getType('integer')],
    returns: currentDb.public.getType('numeric'),
    implementation: (val: number, decimals: number) => {
      if (val === null || val === undefined) return null;
      const factor = Math.pow(10, decimals);
      return Math.round(Number(val) * factor) / factor;
    },
  });

  // Read and apply migration DDL
  const migrationPath = path.join(__dirname, '..', 'src', 'db', 'migrations', '001_initial.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // pg-mem doesn't need INDEX IF NOT EXISTS, raw DDL runs cleanly
  currentDb.public.none(sql);

  const adapter = currentDb.adapters.createPg();
  currentPool = new adapter.Pool() as unknown as pg.Pool;

  setPool(currentPool);
  return currentPool;
}

export async function cleanupTestDatabase(): Promise<void> {
  await closePool();
  currentDb = null;
  currentPool = null;
}
