import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // Run each test file in its own context so global state & module cache are
    // cleared automatically between files – this is the main lever to stop
    // heap growth across the suite.
    isolate: true,
    // @ts-expect-error threads is valid but maybe not in types
    threads: true,
    // Run sequentially in the main thread – keeps peak memory even lower and
    // avoids spawning worker threads that would require their own TypeScript
    // program instances.
    maxConcurrency: 1,
    testTimeout: 30000,
    // global setup to silence MaxListeners warnings
    setupFiles: [
      "tests/setup.ts",
    ],
    // Ensure spies & mocks don't accumulate call history across tests
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
  },
  resolve: {
    alias: {
      src: resolve(__dirname, 'src'),
    },
  },
}); 