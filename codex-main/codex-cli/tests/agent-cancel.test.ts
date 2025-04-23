import { describe, it, expect, vi } from "vitest";
// Mock the OpenAI SDK used inside AgentLoop so we can control streaming events.
class FakeStream {
  private aborted = false;
  
  public controller = { 
    abort: vi.fn(() => {
      this.aborted = true;
    }) 
  };

  async *[Symbol.asyncIterator]() {
    // Check for abortion before yielding anything
    if (this.aborted) {
      return;
    }
    
    // Immediately yield a function_call item.
    yield {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "call1",
        name: "shell",
        arguments: JSON.stringify({ cmd: ["node", "-e", "console.log('hi')"] }),
      },
    } as any;

    // Check for abortion again before yielding the next item
    if (this.aborted) {
      return;
    }

    // Indicate turn completion with the same function_call.
    yield {
      type: "response.completed",
      response: {
        id: "resp1",
        status: "completed",
        output: [
          {
            type: "function_call",
            id: "call1",
            name: "shell",
            arguments: JSON.stringify({
              cmd: ["node", "-e", "console.log('hi')"],
            }),
          },
        ],
      },
    } as any;
  }
}

// Factory function to create new instances each time
// This prevents sharing state between test runs
const createFakeStream = () => new FakeStream();

vi.mock("openai", () => {
  class FakeOpenAI {
    public responses = {
      create: async () => createFakeStream()
    };
  }
  class APIConnectionTimeoutError extends Error {}
  return { __esModule: true, default: FakeOpenAI, APIConnectionTimeoutError };
});

// Mock the approvals and formatCommand helpers referenced by handle‑exec‑command.
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

// Stub the logger to avoid file‑system side effects during tests.
vi.mock("../src/utils/agent/log.js", () => ({
  __esModule: true,
  log: () => {},
  isLoggingEnabled: () => false,
}));

// Added fake timers
vi.useFakeTimers();
vi.setSystemTime(new Date());

// mock handleExecCommand with signal handling and timeout
vi.mock("../src/utils/agent/handle-exec-command.js", () => {
  return {
    handleExecCommand: async (_args: any, { signal }: { signal: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        // Initialize state
        let timeoutId: NodeJS.Timeout | undefined = undefined;
        let intervalId: NodeJS.Timeout | undefined = undefined;
        let cleaned = false;
        
        // Clean up function to avoid resource leaks
        const cleanup = () => {
          if (cleaned) return; // Ensure idempotency
          cleaned = true;
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = undefined;
          }
          
          // Remove abort listener to prevent memory leaks
          if (typeof signal.removeEventListener === 'function') {
            try {
              signal.removeEventListener('abort', abortListener);
            } catch (e) {
              // Ignore errors during cleanup
            }
          }
        };
        
        // Handler for abort signal
        const abortListener = () => {
          if (signal.aborted) {
            cleanup();
            resolve({ code: 130, outputText: "aborted", metadata: {} } as any);
          }
        };
        
        // Add abort listener
        signal.addEventListener('abort', abortListener, { once: true });
        
        // Check signal initially since it might already be aborted
        if (signal.aborted) {
          cleanup();
          return resolve({ code: 130, outputText: "aborted", metadata: {} } as any);
        }
        
        // Set up polling interval to check abort state
        intervalId = setInterval(() => {
          if (signal.aborted) {
            cleanup();
            resolve({ code: 130, outputText: "aborted", metadata: {} } as any);
          }
        }, 10);
        
        // Safety kill: If not aborted within 1s, force end (reduced from 3s)
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("Mock handleExecCommand timed out after 1s"));
        }, 1000);
      });
    },
  };
});

// After mocking dependencies we can import the modules under test.
import { AgentLoop } from "../src/utils/agent/agent-loop.js";
// Removed handleExec import as it's mocked globally now
// import * as handleExec from "../src/utils/agent/handle-exec-command.js";

const _describe = describe.only;

_describe("Agent cancellation", () => {
  // Single basic test to verify our FakeStream modifications
  it("does not emit function_call_output after cancel", async () => {
    // Use real timers for this test
    vi.useRealTimers();
    
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
      onItem: (item) => {
        received.push(item);
      },
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" } as any),
      onLastResponseId: () => {},
    });

    const userMsg = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "say hi" }],
      },
    ] as any;

    // Start the agent loop
    const runPromise = agent.run(userMsg);

    // Give the agent a moment to start processing
    await new Promise((r) => setTimeout(r, 10));

    // Cancel the task
    agent.cancel();

    // Wait for things to settle
    await new Promise((r) => setTimeout(r, 20));
    
    // Terminate properly
    await agent.terminate();
    
    // Swallow any errors caused by cancellation
    await runPromise.catch(() => {});

    // Ensure no function_call_output items were emitted after cancellation
    const hasOutput = received.some((i) => i.type === "function_call_output");
    expect(hasOutput).toBe(false);
  });
});
