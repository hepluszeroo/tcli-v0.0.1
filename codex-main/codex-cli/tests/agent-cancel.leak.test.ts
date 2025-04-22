import { afterEach, expect, test, vi, beforeAll } from 'vitest';
import { AgentLoop } from '../src/utils/agent/agent-loop.js';

// Mock the OpenAI SDK with a minimal implementation
vi.mock("openai", () => {
  class FakeOpenAI {
    public responses = {
      create: async () => ({
        controller: { abort: () => {} },
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'response.completed',
            response: {
              id: 'resp-1',
              status: 'completed',
              output: [],
            },
          } as any;
        },
      }),
    };
  }
  class APIConnectionTimeoutError extends Error {}
  return { __esModule: true, default: FakeOpenAI, APIConnectionTimeoutError };
});

// Mock other dependencies with minimal implementations
vi.mock("../src/approvals.js", () => ({
  __esModule: true,
  alwaysApprovedCommands: new Set<string>(),
  canAutoApprove: () => ({ type: "auto-approve", runInSandbox: false } as any),
  isSafeCommand: () => null,
}));

vi.mock("../src/format-command.js", () => ({
  __esModule: true,
  formatCommandForDisplay: (cmd: Array<string>) => cmd.join(" "),
}));

vi.mock("../src/utils/agent/log.js", () => ({
  __esModule: true,
  log: () => {},
  isLoggingEnabled: () => false,
}));

vi.mock("../src/utils/agent/handle-exec-command.js", () => ({
  handleExecCommand: async () => ({ outputText: "dummy", metadata: {} } as any),
}));

// Force garbage collection if available
const forceGC = () => {
  if (typeof global.gc === 'function') {
    global.gc();
  }
};

// Create a minimal AgentLoop instance
const createMinimalAgentLoop = () => new AgentLoop({
  model: "dummy",
  approvalPolicy: { mode: "auto" } as any,
  additionalWritableRoots: [],
  onItem: () => {},
  onLoading: () => {},
  getCommandConfirmation: async () => ({ review: "yes" } as any),
  onLastResponseId: () => {},
  config: {
    model: "dummy",
    instructions: "",
    notify: false,
    environment: "headless",
  } as any,
});

// Test that multiple cancel operations don't cause memory growth
test('AgentLoop.cancel does not grow heap', async () => {
  // Use real timers for this test
  vi.useRealTimers();
  
  // Force GC to get stable baseline
  forceGC();
  const before = process.memoryUsage().heapUsed;
  console.log(`Initial heap: ${(before / 1024 / 1024).toFixed(2)} MB`);

  // Standard user message to reuse
  const userMsg = [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    },
  ] as any;

  // Run 10 cancel cycles (enough to detect leaks without timeout issues)
  for (let i = 0; i < 10; i++) {
    const loop = createMinimalAgentLoop();
    // Don't await the run promise fully - just start it
    const runPromise = loop.run(userMsg);
    // Wait briefly then cancel and terminate
    await new Promise(r => setTimeout(r, 5));
    loop.cancel();
    await new Promise(r => setTimeout(r, 5));
    loop.terminate();
    // Swallow any errors from the canceled promise
    await runPromise.catch(() => {});
  }

  // Force cleanup
  forceGC();
  forceGC(); // Double GC to ensure thorough collection
  
  const after = process.memoryUsage().heapUsed;
  console.log(`Final heap: ${(after / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Delta: ${((after - before) / 1024 / 1024).toFixed(2)} MB`);
  
  // Less than 5MB growth is acceptable
  expect(after - before).toBeLessThan(5 * 1024 * 1024);
}, 10000);