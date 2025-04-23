import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- OpenAI stream mock ----------------------------------------------------

// Move all mock definition to the factory function to avoid hoisting issues
vi.mock("openai", () => {
  // Define the stream class inside the factory function
  class FakeStream {
    public controller = { abort: vi.fn() };
    private terminated = false;

    // Make sure the iterator properly handles early termination
    async *[Symbol.asyncIterator]() {
      // Immediately ask for a shell function call so we can test that the
      // subsequent function_call_output never gets surfaced after terminate().
      if (this.terminated) return;
      
      yield {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "call‑terminate‑1",
          name: "shell",
          arguments: JSON.stringify({ cmd: ["sleep", "0.1"] }), // Reduced sleep time
        },
      } as any;

      // Check for termination between yields to avoid endless iteration
      if (this.terminated) return;
      
      // Turn completion echoing the same function call.
      yield {
        type: "response.completed",
        response: {
          id: "resp‑terminate‑1",
          status: "completed",
          output: [
            {
              type: "function_call",
              id: "call‑terminate‑1",
              name: "shell",
              arguments: JSON.stringify({ cmd: ["sleep", "0.1"] }), // Reduced sleep time
            },
          ],
        },
      } as any;
    }
    
    // Add a method to properly terminate the stream
    abort() {
      this.terminated = true;
      this.controller.abort();
    }
  }

  // Create a single instance that will be reused
  const fakeStreamInstance = new FakeStream();
  
  class FakeOpenAI {
    public responses = {
      create: async () => {
        // Return the singleton stream instance for better cleanup
        return fakeStreamInstance;
      },
    };
  }
  
  class APIConnectionTimeoutError extends Error {}
  return { __esModule: true, default: FakeOpenAI, APIConnectionTimeoutError };
});

// --- Helpers referenced by handle‑exec‑command -----------------------------

vi.mock("../src/approvals.js", () => {
  return {
    __esModule: true,
    alwaysApprovedCommands: new Set<string>(),
    canAutoApprove: () =>
      ({ type: "auto-approve", runInSandbox: false } as any),
    isSafeCommand: () => null,
  };
});

vi.mock("../src/format-command.js", () => {
  return {
    __esModule: true,
    formatCommandForDisplay: (cmd: Array<string>) => cmd.join(" "),
  };
});

// Stub logger to avoid filesystem side‑effects
vi.mock("../src/utils/agent/log.js", () => ({
  __esModule: true,
  log: () => {},
  isLoggingEnabled: () => false,
}));

// After dependency mocks we can import the modules under test.

import { AgentLoop } from "../src/utils/agent/agent-loop.js";
import * as handleExec from "../src/utils/agent/handle-exec-command.js";

describe("Agent terminate (hard cancel)", () => {
  // Force garbage collection to prevent memory growth between tests
  afterEach(() => {
    if (typeof global.gc === 'function') {
      global.gc();
    }
  });
  
  // Use fake timers to avoid real timeouts
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("suppresses function_call_output and stops processing once terminate() is invoked", async () => {
    // Simulate a long‑running exec that would normally resolve with output.
    vi.spyOn(handleExec, "handleExecCommand").mockImplementation(
      async (
        _args,
        _config,
        _policy,
        _additionalWritableRoots,
        _getConf,
        abortSignal,
      ) => {
        // Wait until the abort signal is fired or a short time (whichever comes first).
        await new Promise<void>((resolve) => {
          if (abortSignal?.aborted) {
            return resolve();
          }
          const timer = setTimeout(resolve, 100); // Reduced from 2000ms to 100ms
          
          // Use { once: true } to avoid listener leaks
          abortSignal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });

        return { outputText: "should‑not‑happen", metadata: {} } as any;
      },
    );

    const received: Array<any> = [];

    const agent = new AgentLoop({
      model: "any",
      instructions: "",
      config: {
        model: "any",
        instructions: "",
        notify: false,
        environment: "test"
      },
      approvalPolicy: { mode: "auto" } as any,
      additionalWritableRoots: [],
      onItem: (item) => received.push(item),
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" } as any),
      onLastResponseId: () => {},
    });

    const userMsg = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "run long cmd" }],
      },
    ];

    // Start agent loop but don't wait for completion.
    const runPromise = agent.run(userMsg as any);

    // Use fake timers to advance time slightly
    vi.advanceTimersByTime(10);

    // Terminate the agent
    agent.terminate();

    // Advance timers a bit more to resolve any pending promises
    vi.advanceTimersByTime(50);
    
    // Wait for any remaining async operations to complete
    await Promise.resolve();
    
    // Handle the potentially rejected run promise
    await runPromise.catch(() => {/* Expected rejection */});

    // Check that no function call outputs were generated
    const hasOutput = received.some((i) => i.type === "function_call_output");
    expect(hasOutput).toBe(false);
    
    // Let the agent be garbage collected
    if (typeof global.gc === 'function') {
      global.gc();
    }
  });

  it("rejects further run() calls after terminate()", async () => {
    const agent = new AgentLoop({
      model: "any",
      instructions: "",
      config: {
        model: "any",
        instructions: "",
        notify: false,
        environment: "test"
      },
      approvalPolicy: { mode: "auto" } as any,
      additionalWritableRoots: [],
      onItem: () => {},
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" } as any),
      onLastResponseId: () => {},
    });

    agent.terminate();

    const dummyMsg = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "noop" }],
      },
    ];

    let threw = false;
    try {
      // We expect this to fail fast – either by throwing synchronously or by
      // returning a rejected promise.
      await agent.run(dummyMsg as any);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    
    // Let the agent be garbage collected
    if (typeof global.gc === 'function') {
      global.gc();
    }
  });
});
