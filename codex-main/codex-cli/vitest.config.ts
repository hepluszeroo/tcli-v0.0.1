import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // Run each test file in its own context so global state & module cache are
    // cleared automatically between files – this is the main lever to stop
    // heap growth across the suite.
    isolate: true,
    // Re-enabled multi-threading after fixing memory leaks in cancel and terminate
    threads: true,
    // Memory leaks in AgentLoop.cancel() and AgentLoop.terminate() have been fixed,
    // so we can now safely run tests in parallel
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