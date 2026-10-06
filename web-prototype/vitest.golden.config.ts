import { defineConfig } from 'vitest/config';

/**
 * `npm run golden`: regenerates tests/fixtures/golden/*.json (the parity
 * fixtures for the Swift port) by running ONLY scripts/golden/*.test.ts.
 * The normal test run (vite.config.ts → tests/**) never writes them; it only
 * checks them (tests/golden.test.ts).
 */
export default defineConfig({
  test: {
    include: ['scripts/golden/*.test.ts'],
    environment: 'node',
    // One file writes the fixtures; never run it in parallel with itself.
    fileParallelism: false,
  },
});
