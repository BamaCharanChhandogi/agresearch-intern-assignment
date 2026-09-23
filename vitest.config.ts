import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Run tests sequentially — they share a database
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 15_000,
  },
});
