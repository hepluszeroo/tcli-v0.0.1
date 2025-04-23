import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
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
    // The tsconfigPaths plugin now handles path aliases based on tsconfig.json
    // This explicit configuration is kept for compatibility with older tools
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
}); 