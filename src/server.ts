import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { closePool } from './db/pool.js';

const config = loadConfig();
const app = buildApp();

async function start() {
  try {
    console.log(`Starting AgResearch Labs API on port ${config.port}...`);

    // Ensure database schema is migrated before accepting traffic
    try {
      await runMigrations();
    } catch (migErr) {
      console.warn('Auto-migration warning (check PostgreSQL connection):', (migErr as Error).message);
    }

    const address = await app.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`Server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    await closePool();
    process.exit(1);
  }
}

// Graceful shutdown handling
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}. Gracefully shutting down...`);
    try {
      await app.close();
      await closePool();
      console.log('Server and database pool closed cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
}

start();
