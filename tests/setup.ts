import { beforeEach, afterAll } from 'vitest';
import { resetTestDatabase, cleanupTestDatabase } from './test-db.js';

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await cleanupTestDatabase();
});
