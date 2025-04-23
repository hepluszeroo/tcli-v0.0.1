import { afterEach, expect, test, vi, describe } from 'vitest';
import { AgentLoop } from '../src/utils/agent/agent-loop.js';
import { debugLog } from '../src/utils/debug';

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
  } else {
    console.warn('⚠️ Test running without --expose-gc - memory leak test may be inaccurate');
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

// Test if global.gc is available, skip the test if not
const shouldRunTest = () => {
  if (typeof global.gc !== 'function') {
    return 'Skipping test: Node must be run with --expose-gc to test memory leaks';
  }
  return true;
};

// Main regression test for cancel leak
describe('Agent cancel memory leak tests', () => {
  // Test that multiple cancel operations don't cause memory growth
  test('AgentLoop.cancel does not grow heap', async () => {
    // Check for --expose-gc flag
    const canRun = shouldRunTest();
    if (canRun !== true) {
      console.log(canRun);
      return;
    }

    // Use real timers for this test
    vi.useRealTimers();
    
    // Force GC to get stable baseline
    forceGC();
    const initialWarningCount = process.listenerCount('warning');
    const before = process.memoryUsage().heapUsed;
    console.log(`Initial heap: ${(before / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Initial warning listeners: ${initialWarningCount}`);

    // Standard user message to reuse
    const userMsg = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    ] as any;

    // Track heap at intervals
    const memorySnapshots: {iteration: number, heap: number}[] = [];
    const takeSnapshot = (iteration: number) => {
      forceGC();
      const heap = process.memoryUsage().heapUsed;
      memorySnapshots.push({iteration, heap});
      return heap;
    };

    // Initial snapshot
    takeSnapshot(0);
    
    // Run 50 cancel cycles (enough to detect leaks)
    const ITERATIONS = 50;
    for (let i = 0; i < ITERATIONS; i++) {
      const loop = createMinimalAgentLoop();
      // Don't await the run promise fully - just start it
      const runPromise = loop.run(userMsg);
      // Wait briefly then cancel
      await new Promise(r => setTimeout(r, 5));
      loop.cancel();
      
      // Terminate and clean up properly
      loop.terminate();
      
      // Swallow any errors from the terminated promise
      await runPromise.catch(() => {});
      
      // Take snapshots at intervals
      if (i % 10 === 9 || i === ITERATIONS - 1) {
        takeSnapshot(i + 1);
      }

      // Add some debug output
      if (process.env.DEBUG_CANCEL && i % 10 === 0) {
        debugLog(`[DEBUG_CANCEL] Completed ${i+1} iterations`);
      }
    }

    // Force cleanup
    forceGC();
    forceGC(); // Double GC to ensure thorough collection
    
    const after = process.memoryUsage().heapUsed;
    const finalWarningCount = process.listenerCount('warning');
    console.log(`Final heap: ${(after / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Final warning listeners: ${finalWarningCount}`);
    console.log(`Delta: ${((after - before) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Warning listener delta: ${finalWarningCount - initialWarningCount}`);
    
    // Print memory growth pattern
    console.log('Memory growth pattern:');
    for (let i = 1; i < memorySnapshots.length; i++) {
      const prev = memorySnapshots[i-1];
      const curr = memorySnapshots[i];
      const delta = (curr.heap - prev.heap) / (1024 * 1024);
      const perIteration = delta / (curr.iteration - prev.iteration);
      console.log(`  Iterations ${prev.iteration}-${curr.iteration}: +${delta.toFixed(2)}MB total, ${perIteration.toFixed(4)}MB per iteration`);
    }
    
    // Less than 5MB growth is acceptable
    expect(after - before).toBeLessThan(5 * 1024 * 1024);
    
    // Ensure no new warning listeners were added
    expect(finalWarningCount).toBe(initialWarningCount);
  }, 20000);

  // Test API invariants
  test('cancel() can be called multiple times safely', async () => {
    // Use real timers for this test
    vi.useRealTimers();
    
    const loop = createMinimalAgentLoop();
    
    // Should not throw or have side effects when called multiple times
    loop.cancel();
    loop.cancel();
    loop.cancel();
    
    // Verify state is consistent - no errors or warnings raised
    expect(true).toBe(true); // Passes if no exceptions thrown
    
    // Clean up
    loop.terminate();
  });

  // Test that cancel properly resets internal state
  test('cancel() properly resets internal state', async () => {
    // Use real timers for this test
    vi.useRealTimers();
    
    const loop = createMinimalAgentLoop();
    
    const userMsg = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "test reset" }],
      },
    ] as any;
    
    // Start a run but cancel immediately
    const runPromise = loop.run(userMsg);
    await new Promise(r => setTimeout(r, 5));
    loop.cancel();
    
    // Swallow any errors
    await runPromise.catch(() => {});
    
    // Start another run - should work without errors
    const runPromise2 = loop.run(userMsg);
    await new Promise(r => setTimeout(r, 5));
    
    // Cancel and clean up
    loop.cancel();
    loop.terminate();
    await runPromise2.catch(() => {});
    
    // Test passes if we got here without errors
    expect(true).toBe(true);
  });

  // Stress test with multiple concurrent cancellations
  test('stress test with multiple concurrent cancellations', async () => {
    if (!shouldRunTest()) {
      return;
    }
    
    // Use real timers for this test
    vi.useRealTimers();
    
    // Force GC to get stable baseline
    forceGC();
    const before = process.memoryUsage().heapUsed;
    
    const userMsg = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "concurrent test" }],
      },
    ] as any;
    
    // Create multiple instances and cancel them concurrently
    const instances = [];
    const INSTANCES = 10;
    
    // Create instances
    for (let i = 0; i < INSTANCES; i++) {
      const loop = createMinimalAgentLoop();
      instances.push(loop);
      // Start but don't await
      loop.run(userMsg).catch(() => {});
    }
    
    // Wait a moment for runs to start
    await new Promise(r => setTimeout(r, 10));
    
    // Cancel all concurrently
    instances.forEach(loop => loop.cancel());
    
    // Terminate all concurrently
    instances.forEach(loop => loop.terminate());
    
    // Wait for GC
    await new Promise(r => setTimeout(r, 50));
    forceGC();
    
    const after = process.memoryUsage().heapUsed;
    const delta = (after - before) / (1024 * 1024);
    
    console.log(`Memory usage after concurrent cancellation: ${delta.toFixed(2)} MB`);
    
    // Should not increase memory significantly
    expect(delta).toBeLessThan(5);
  }, 10000);
});