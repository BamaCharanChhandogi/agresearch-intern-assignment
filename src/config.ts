export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  databaseUrlTest?: string;
  storageMode: 'postgres' | 'memory';
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/agresearch',
    databaseUrlTest: process.env.DATABASE_URL_TEST || 'postgres://postgres:postgres@localhost:5432/agresearch_test',
    storageMode: (process.env.STORAGE_MODE as 'postgres' | 'memory') || 'postgres',
  };
}
