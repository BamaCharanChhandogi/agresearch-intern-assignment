import pg from 'pg';
import { loadConfig } from '../config.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export function getPool(customUrl?: string): pg.Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const config = loadConfig();
  const connectionString = customUrl || config.databaseUrl;

  poolInstance = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  poolInstance.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
  });

  return poolInstance;
}

export function setPool(customPool: pg.Pool): void {
  poolInstance = customPool;
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(text, params);
}
