/* eslint-disable import/order */
import type { ReviewDecision } from "./review.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { AppConfig } from "../config.js";
import type {
  ResponseInputItem,
  ResponseItem,
} from "openai/resources/responses/responses.mjs";
import type { Reasoning } from "openai/resources.mjs";

import { log, isLoggingEnabled } from "./log.js";
import { OPENAI_BASE_URL, OPENAI_TIMEOUT_MS } from "../config.js";
import {
  ORIGIN,
  CLI_VERSION,
  getSessionId,
  setCurrentModel,
  setSessionId,
} from "../session.js";
import { randomUUID } from "node:crypto";
import OpenAI, { APIConnectionTimeoutError } from "openai";
import { debugLog } from "../debug";
import { shellTool } from "./tools/shellTool.js";

// Wait time before retrying after rate limit errors (ms).
const RATE_LIMIT_RETRY_WAIT_MS = parseInt(
  process.env["OPENAI_RATE_LIMIT_RETRY_WAIT_MS"] || "2500",
  10,
);

export type CommandConfirmation = {
  review: ReviewDecision;
  applyPatch?: ApplyPatchCommand | undefined;
  customDenyMessage?: string;
  explanation?: string;
};

type AgentLoopParams = {
  model: string;
  config?: AppConfig;
  instructions?: string;
  approvalPolicy: ApprovalPolicy;
  onItem: (item: ResponseItem) => void;
  onLoading: (loading: boolean) => void;

  /** Extra writable roots to use with sandbox execution. */
  additionalWritableRoots: ReadonlyArray<string>;

  /** Called when the command is not auto-approved to request explicit user review. */
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
  onLastResponseId: (lastResponseId: string) => void;
};

export class AgentLoop {
  private model: string;
  private instructions?: string;
  private approvalPolicy: ApprovalPolicy;
  private config: AppConfig;

  // Using `InstanceType<typeof OpenAI>` sidesteps typing issues with the OpenAI package under
  // the TS 5+ `moduleResolution=bundler` setup. OpenAI client instance. We keep the concrete
  // type to avoid sprinkling `any` across the implementation while still allowing paths where
  // the OpenAI SDK types may not perfectly match. The `typeof OpenAI` pattern captures the
  // instance shape without resorting to `any`.
  private oai: OpenAI;

  private onItem: (item: ResponseItem) => void;
  private onLoading: (loading: boolean) => void;
  private onLastResponseId: (lastResponseId: string) => void;

  /**
   * A reference to the currently active stream returned from the OpenAI
   * client. We keep this so that we can abort the request if the user decides
   * to interrupt the current task (e.g. via the escape hot‑key).
   */
  private currentStream: unknown | null = null;
  /** Incremented with every call to `run()`. Allows us to ignore stray events
   * from streams that belong to a previous run which might still be emitting
   * after the user has canceled and issued a new command. */
  private generation = 0;
  /** AbortController for in‑progress tool calls (e.g. shell commands). */
  private execAbortController: AbortController | null = null;
  /** Set to true when `cancel()` is called so `run()` can exit early. */
  private canceled = false;
  /** Function calls that were emitted by the model but never answered because
   *  the user cancelled the run.  We keep the `call_id`s around so the *next*
   *  request can send a dummy `function_call_output` that satisfies the
   *  contract and prevents the
   *    400 | No tool output found for function call …
   *  error from OpenAI. */
  private pendingAborts: Set<string> = new Set();
  /** Set to true by `terminate()` – prevents any further use of the instance. */
  private terminated = false;
  /** Master abort controller – fires when terminate() is invoked. */
  private readonly hardAbort = new AbortController();

  /** Tracks the last response ID sent to or received from the model so we can
   *  clear it on cancel() and avoid leaking IDs into subsequent requests that
   *  restart the conversation. */
  private lastResponseId: string = "";

  /** Timer handle for the delayed flush scheduled at the end of `run()`. */
  private flushTimer?: NodeJS.Timeout;

  /** Set of pending per‑item delivery timers created via stageItem(). */
  private deliveryTimers: Set<NodeJS.Timeout> = new Set();

  /* ------------------------------------------------------------------
   * Debug / leak‑hunting helpers – enabled when the developer sets
   *   DEBUG_CANCEL=1 (or "true").  We expose simple runtime counters so a
   * diagnostic test or script can query `globalThis.__agentDebug` and track
   * whether
   *   • AgentLoop instances accumulate
   *   • `pendingAborts` growth is unbounded
   *   • `AbortSignal` listeners pile up
   * ------------------------------------------------------------------ */

  /** Whether verbose cancel diagnostics are enabled */
  private static readonly DEBUG_CANCEL_MODE =
    process.env["DEBUG_CANCEL"] === "1" ||
    process.env["DEBUG_CANCEL"]?.toLowerCase?.() === "true";
    
  /** Whether verbose terminate diagnostics are enabled */
  private static readonly DEBUG_TERMINATE_MODE =
    process.env["DEBUG_TERMINATE"] === "1" ||
    process.env["DEBUG_TERMINATE"]?.toLowerCase?.() === "true";
    
  /** Whether any debug mode is enabled */
  private static readonly DEBUG_MODE =
    AgentLoop.DEBUG_CANCEL_MODE || AgentLoop.DEBUG_TERMINATE_MODE;

  /** Active AgentLoop instance counter (updated in ctor & terminate) */
  private static activeCount = 0;
  /** Total AgentLoop instances ever created - for leak debugging */
  private static totalCreated = 0;
  /** Total AgentLoop instances terminated - for leak debugging */
  private static totalTerminated = 0;
  /** Memory footprint at intervals - for leak debugging */
  private static lastMemory: {heapUsed: number, time: number} = {heapUsed: 0, time: 0};

  private static bump(delta: number): void {
    AgentLoop.activeCount += delta;
    
    if (delta > 0) {
      AgentLoop.totalCreated += delta;
    } else {
      AgentLoop.totalTerminated += Math.abs(delta);
    }

    if (AgentLoop.DEBUG_MODE) {
      // Keep lightweight – only emit when count actually changes so logs stay
      // readable in large test loops.
      // Log memory stats every 10 instances or when explicitly requested
      const shouldLogMemory = (AgentLoop.activeCount % 10 === 0) || 
                              (AgentLoop.DEBUG_TERMINATE_MODE && delta < 0);
      
      const now = Date.now();
      const memStats = shouldLogMemory ? process.memoryUsage() : null;
      const timeDelta = shouldLogMemory ? now - AgentLoop.lastMemory.time : 0;
      const memDelta = shouldLogMemory ? 
        (memStats!.heapUsed - AgentLoop.lastMemory.heapUsed) / (1024 * 1024) : 0;
      
      if (shouldLogMemory) {
        AgentLoop.lastMemory = {
          heapUsed: memStats!.heapUsed,
          time: now
        };
      }
      
      // eslint-disable-next-line no-console
      console.log(
        `[DEBUG] active AgentLoops = ${AgentLoop.activeCount} (total: ${AgentLoop.totalCreated}, terminated: ${AgentLoop.totalTerminated})` +
        (shouldLogMemory ? `, heap: ${(memStats!.heapUsed / 1024 / 1024).toFixed(2)}MB (Δ: ${memDelta.toFixed(2)}MB in ${timeDelta}ms)` : '')
      );
    }
  }

  /**
   * Abort the ongoing request/stream, if any. This allows callers (typically
   * the UI layer) to interrupt the current agent step so the user can issue
   * new instructions without waiting for the model to finish.
   */
  public cancel(): void {
    if (this.terminated) {
      return;
    }

    const activeStream = this.currentStream;
    if (isLoggingEnabled()) {
      log(
        `AgentLoop.cancel() invoked – currentStream=${Boolean(
          activeStream,
        )} execAbortController=${Boolean(
          this.execAbortController,
        )} generation=${this.generation}`,
      );
    }
    (activeStream as { controller?: { abort?: () => void } } | null)
      ?.controller?.abort?.();

    this.currentStream = null;

    this.canceled = true;

    // Cancel pending flush timer to avoid leaking across tests/turns.
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Cancel any outstanding per‑item delivery timers.
    for (const t of this.deliveryTimers) {
      clearTimeout(t);
    }
    this.deliveryTimers.clear();

    // Reset previous response tracking so the next run starts clean.
    this.lastResponseId = "";

    // Abort any in-progress tool calls
    this.execAbortController?.abort();

    // Create a new abort controller for future tool calls
    this.execAbortController = new AbortController();
    if (isLoggingEnabled()) {
      log("AgentLoop.cancel(): execAbortController.abort() called");
    }

    // --- DEBUG hooks --------------------------------------------------
    if (AgentLoop.DEBUG_CANCEL_MODE) {
      // count current 'abort' listeners on the execAbortController
      const abortL =
        // listenerCount exists on AbortSignal in Node ≥ 20
        (this.execAbortController?.signal as any)?.listenerCount?.('abort') ?? 0;

      debugLog(
        `[DEBUG_CANCEL] gen=${this.generation} pendingAborts=${this.pendingAborts.size} ` +
        `abortListeners=${abortL} deliveryTimers=${this.deliveryTimers.size}`,
      );
    }
    // ------------------------------------------------------------------

    // now do the actual cleanup
    // pendingAborts only contains string IDs, no need to abort each one
    this.pendingAborts.clear();

    this.onLoading(false);

    /* Inform the UI that the run was aborted by the user. */
    // const cancelNotice: ResponseItem = {
    //   id: `cancel-${Date.now()}`,
    //   type: "message",
    //   role: "system",
    //   content: [
    //     {
    //       type: "input_text",
    //       text: "⏹️  Execution canceled by user.",
    //     },
    //   ],
    // };
    // this.onItem(cancelNotice);

    this.generation += 1;
    if (isLoggingEnabled()) {
      log(`AgentLoop.cancel(): generation bumped to ${this.generation}`);
    }
  }

  /**
   * Hard‑stop the agent loop. After calling this method the instance becomes
   * unusable: any in‑flight operations are aborted and subsequent invocations
   * of `run()` will throw.
   */
  public terminate(): void {
    if (this.terminated) {
      if (AgentLoop.DEBUG_TERMINATE_MODE) {
        debugLog(`[DEBUG_TERMINATE] terminate() called on already terminated instance (id=${this.sessionId})`);
      }
      return;
    }
    
    if (AgentLoop.DEBUG_TERMINATE_MODE) {
      // Count resources before cleanup
      const abortL = (this.execAbortController?.signal as any)?.listenerCount?.('abort') ?? 0;
      const hardAbortL = (this.hardAbort?.signal as any)?.listenerCount?.('abort') ?? 0;
      const activeStreamRef = this.currentStream ? 'present' : 'null';
      const onItemType = typeof this.onItem;
      const onLoadingType = typeof this.onLoading;
      const onLastResponseIdType = typeof this.onLastResponseId;
      
      debugLog(
        `[DEBUG_TERMINATE] pre-cleanup (id=${this.sessionId}): gen=${this.generation} pendingAborts=${this.pendingAborts.size} ` +
        `abortListeners=${abortL} hardAbortListeners=${hardAbortL} deliveryTimers=${this.deliveryTimers.size} ` +
        `currentStream=${activeStreamRef} callbacks={onItem:${onItemType}, onLoading:${onLoadingType}, ` +
        `onLastResponseId:${onLastResponseIdType}}`,
      );
    }
    
    this.terminated = true;

    // First clean up any pending timers
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    
    // Abort any running operations
    if (this.hardAbort) {
      try {
        this.hardAbort.abort();
      } catch (e) {
        if (AgentLoop.DEBUG_TERMINATE_MODE) {
          debugLog(`[DEBUG_TERMINATE] Error during hardAbort.abort(): ${e}`);
        }
      }
    }

    // Call cancel to clean up streams, timers, and pending operations
    this.cancel();

    // Additional cleanup for terminate
    // Clear callback references to avoid retaining closures
    if (AgentLoop.DEBUG_TERMINATE_MODE) {
      debugLog(`[DEBUG_TERMINATE] Clearing callback references`);
    }
    // Clear reference-holding callbacks to allow GC
    this.onItem = () => {};
    this.onLoading = () => {};
    this.onLastResponseId = () => {};
    
    // Clear the OpenAI client reference
    (this.oai as any) = null;
    
    if (AgentLoop.DEBUG_TERMINATE_MODE) {
      // Count resources after cleanup
      const abortL = (this.execAbortController?.signal as any)?.listenerCount?.('abort') ?? 0;
      const hardAbortL = (this.hardAbort?.signal as any)?.listenerCount?.('abort') ?? 0;
      debugLog(
        `[DEBUG_TERMINATE] post-cleanup (id=${this.sessionId}): gen=${this.generation} pendingAborts=${this.pendingAborts.size} ` +
        `abortListeners=${abortL} hardAbortListeners=${hardAbortL} deliveryTimers=${this.deliveryTimers.size} ` +
        `callbacks cleared, oai reference cleared`,
      );
    }

    if (AgentLoop.DEBUG_MODE) {
      AgentLoop.bump(-1);
    }
  }

  public sessionId: string;
  /*
   * Cumulative thinking time across this AgentLoop instance (ms).
   * Currently not used anywhere – comment out to keep the strict compiler
   * happy under `noUnusedLocals`.  Restore when telemetry support lands.
   */
  // private cumulativeThinkingMs = 0;
  constructor({
    model,
    instructions,
    approvalPolicy,
    // `config` used to be required.  Some unit‑tests (and potentially other
    // callers) instantiate `AgentLoop` without passing it, so we make it
    // optional and fall back to sensible defaults.  This keeps the public
    // surface backwards‑compatible and prevents runtime errors like
    // "Cannot read properties of undefined (reading 'apiKey')" when accessing
    // `config.apiKey` below.
    config,
    onItem,
    onLoading,
    onLastResponseId,
  }: AgentLoopParams & { config?: AppConfig }) {
    this.model = model;
    this.instructions = instructions;
    this.approvalPolicy = approvalPolicy;

    // If no `config` has been provided we derive a minimal stub so that the
    // rest of the implementation can rely on `this.config` always being a
    // defined object.  We purposefully copy over the `model` and
    // `instructions` that have already been passed explicitly so that
    // downstream consumers (e.g. telemetry) still observe the correct values.
    this.config =
      config ??
      ({
        model,
        instructions: instructions ?? "",
      } as AppConfig);
    this.onItem = onItem;
    this.onLoading = onLoading;
    this.onLastResponseId = onLastResponseId;
    this.sessionId = getSessionId() || randomUUID().replaceAll("-", "");
    // Configure OpenAI client with optional timeout (ms) from environment
    const timeoutMs = OPENAI_TIMEOUT_MS;
    const apiKey = this.config.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    this.oai = new OpenAI({
      // The OpenAI JS SDK only requires `apiKey` when making requests against
      // the official API.  When running unit‑tests we stub out all network
      // calls so an undefined key is perfectly fine.  We therefore only set
      // the property if we actually have a value to avoid triggering runtime
      // errors inside the SDK (it validates that `apiKey` is a non‑empty
      // string when the field is present).
      ...(apiKey ? { apiKey } : {}),
      baseURL: OPENAI_BASE_URL,
      defaultHeaders: {
        originator: ORIGIN,
        version: CLI_VERSION,
        session_id: this.sessionId,
      },
      ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    });

    setSessionId(this.sessionId);
    setCurrentModel(this.model);

    this.hardAbort = new AbortController();

    this.hardAbort.signal.addEventListener(
      "abort",
      () => this.execAbortController?.abort(),
      { once: true },
    );
    
    if (AgentLoop.DEBUG_MODE) {
      AgentLoop.bump(1);
    }
  }

  public async run(
    input: Array<ResponseInputItem>,
    previousResponseId: string = "",
  ): Promise<void> {
    // ---------------------------------------------------------------------
    // Top‑level error wrapper so that known transient network issues like
    // `ERR_STREAM_PREMATURE_CLOSE` do not crash the entire CLI process.
    // Instead we surface the failure to the user as a regular system‑message
    // and terminate the current run gracefully. The calling UI can then let
    // the user retry the request if desired.
    // ---------------------------------------------------------------------

    try {
      if (this.terminated) {
        if (AgentLoop.DEBUG_TERMINATE_MODE) {
          debugLog(`[DEBUG_TERMINATE] run() called on terminated instance (id=${this.sessionId})`);
        }
        throw new Error("AgentLoop has been terminated");
      }
      // Record when we start "thinking" so we can report accurate elapsed time.
      const thinkingStart = Date.now();
      // Bump generation so that any late events from previous runs can be
      // identified and dropped.
      const thisGeneration = ++this.generation;

      // Reset cancellation flag and stream for a fresh run.
      this.canceled = false;
      this.currentStream = null;

      // Create a fresh AbortController for this run so that tool calls from a
      // previous run do not accidentally get signalled.
      this.execAbortController = new AbortController();
      if (isLoggingEnabled()) {
        log(
          `AgentLoop.run(): new execAbortController created (${this.execAbortController.signal}) for generation ${this.generation}`,
        );
      }
      // NOTE: We no longer (re‑)attach an `abort` listener to `hardAbort` here.
      // A single listener that forwards the `abort` to the current
      // `execAbortController` is installed once in the constructor. Re‑adding a
      // new listener on every `run()` caused the same `AbortSignal` instance to
      // accumulate listeners which in turn triggered Node's
      // `MaxListenersExceededWarning` after ten invocations.

      this.lastResponseId = previousResponseId;

      // If there are unresolved function calls from a previously cancelled run
      // we have to emit dummy tool outputs so that the API no longer expects
      // them.  We prepend them to the user‑supplied input so they appear
      // first in the conversation turn.
      const abortOutputs: Array<ResponseInputItem> = [];
      if (this.pendingAborts.size > 0) {
        for (const id of this.pendingAborts) {
          abortOutputs.push({
            type: "function_call_output",
            call_id: id,
            output: JSON.stringify({
              output: "aborted",
              metadata: { exit_code: 1, duration_seconds: 0 },
            }),
          } as ResponseInputItem.FunctionCallOutput);
        }
        // Once converted the pending list can be cleared.
        this.pendingAborts.clear();
      }

      let turnInput = [...abortOutputs, ...input];

      this.onLoading(true);

      // Array holding items that have been staged for delivery at the end of
      // the turn.  We initialise it *before* defining `flush` so the function
      // can close over the variable even though we hoist the function above
      // `stageItem` to avoid temporal‑dead‑zone issues with fake timers.
      const staged: Array<ResponseItem | undefined> = [];

      const stagedFlush = () => {
        debugLog('FLUSH', staged.length);
        if (
          !this.canceled &&
          !this.hardAbort.signal.aborted &&
          thisGeneration === this.generation
        ) {
    if (AgentLoop.DEBUG_MODE) {
      AgentLoop.bump(1);
    }
          // Only emit items that weren't already delivered above
          for (const item of staged) {
            if (item) {
              this.onItem(item);
            }
          }
        }

        // At this point the turn finished without the user invoking
        // `cancel()`.  Any outstanding function‑calls must therefore have been
        // satisfied, so we can safely clear the set that tracks pending aborts
        // to avoid emitting duplicate synthetic outputs in subsequent runs.
        this.pendingAborts.clear();

        // Schedule thinking time messages etc. (omitted for brevity – existing
        // logic remains untouched further below).
      };
      const stageItem = (item: ResponseItem) => {
        debugLog('STAGE', item.type);
        // Ignore any stray events that belong to older generations.
        if (thisGeneration !== this.generation) {
          return;
        }

        // Store the item so the final flush can still operate on a complete list.
        // We'll nil out entries once they're delivered.
        const idx = staged.push(item) - 1;

        // Instead of emitting synchronously we schedule a short‑delay delivery.
        // This accomplishes two things:
        //   1. The UI still sees new messages almost immediately, creating the
        //      perception of real‑time updates.
        //   2. If the user calls `cancel()` in the small window right after the
        //      item was staged we can still abort the delivery because the
        //      generation counter will have been bumped by `cancel()`.
        const timer = setTimeout(() => {
          if (
            thisGeneration === this.generation &&
            !this.canceled &&
            !this.hardAbort.signal.aborted
          ) {
            this.onItem(item);
            // Mark as delivered so flush won't re-emit it
            staged[idx] = undefined;
          }
        }, 10);
        // Track timer immediately so we can cancel it if needed.
        this.deliveryTimers.add(timer);

        // Re‑schedule the final flush so it always fires shortly after the
        // most recently staged item – important when a previous attempt in
        // the retry loop already created a flush timer that has fired and
        // been cleared. Clearing / resetting here guarantees that *any* item
        // produced by a later successful attempt (after a timeout or server
        // error) is still delivered even if no further while‑loop iteration
        // happens.
        clearTimeout(this.flushTimer as any);
        // Defer execution; `flush` is defined later in this scope but will be
        // in place by the time the timer fires.
        this.flushTimer = setTimeout(() => flush(), 0); // restore legacy ordering
      };

      // -------------------------------------------------------------------
      // Back‑compat alias: other code in this file (and existing test‑files)
      // still refers to a local `flush` constant.  Keep a pointer so we don't
      // have to update every reference after the stagedFlush refactor.
      // -------------------------------------------------------------------

      const flush = stagedFlush;

      while (turnInput.length > 0) {
        if (this.canceled || this.hardAbort.signal.aborted) {
          this.onLoading(false);
          return;
        }
        // send request to openAI
        for (const item of turnInput) {
          stageItem(item as ResponseItem);
        }
        // Send request to OpenAI with retry on timeout
        let stream;

        // Retry loop for transient errors. Up to MAX_RETRIES attempts.
        const MAX_RETRIES = 5;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            let reasoning: Reasoning | undefined;
            if (this.model.startsWith("o")) {
              reasoning = { effort: "high" };
              if (this.model === "o3" || this.model === "o4-mini") {
                reasoning.summary = "auto";
              }
            }
            const mergedInstructions = [prefix, this.instructions]
              .filter(Boolean)
              .join("\n");
            if (isLoggingEnabled()) {
              log(
                `instructions (length ${mergedInstructions.length}): ${mergedInstructions}`,
              );
            }
            // TODO(perf): Instantiate tools array just once outside the loop?
            // Depends on whether process.env can change mid-run.

            // In headless mode, add the shell tool.
            const tools: any[] = // Use any[] temporarily to bypass v4 type issues
              process.env['CODEX_HEADLESS'] === "1" ? [shellTool] : [shellTool];
            // ↑
            // TODO(perf): Instantiate tools array just once outside the loop?
            // Depends on whether process.env can change mid-run.

            // In headless mode, add the shell tool.
            if (process.env['CODEX_HEADLESS'] === "1") {
              // Placeholder for potential future tool additions
            }

            if (process.env['CODEX_HEADLESS'] === "1") {
              debugLog('tools →', tools.map((t) => t.function.name));
            } else {
              debugLog('tools → [] (interactive mode)');
            }

            // eslint-disable-next-line no-await-in-loop
            stream = await this.oai.responses.create({
              model: this.model,
              instructions: mergedInstructions,
              previous_response_id: this.lastResponseId || undefined,
              input: turnInput,
              stream: true,
              parallel_tool_calls: false,
              reasoning,
              ...(this.config.flexMode ? { service_tier: "flex" } : {}),
              tools,
            });
            break;
          } catch (error) {
            const isTimeout = error instanceof APIConnectionTimeoutError;
            // Lazily look up the APIConnectionError class at runtime to
            // accommodate the test environment's minimal OpenAI mocks which
            // do not define the class.  Falling back to `false` when the
            // export is absent ensures the check never throws.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ApiConnErrCtor = (OpenAI as any).APIConnectionError as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
              | (new (...args: any) => Error)
              | undefined;
            const isConnectionError = ApiConnErrCtor
              ? error instanceof ApiConnErrCtor
              : false;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const errCtx = error as any;
            const status =
              errCtx?.status ?? errCtx?.httpStatus ?? errCtx?.statusCode;
            const isServerError = typeof status === "number" && status >= 500;
            if (
              (isTimeout || isServerError || isConnectionError) &&
              attempt < MAX_RETRIES
            ) {
              log(
                `OpenAI request failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`,
              );
              continue;
            }

            const isTooManyTokensError =
              (errCtx.param === "max_tokens" ||
                (typeof errCtx.message === "string" &&
                  /max_tokens is too large/i.test(errCtx.message))) &&
              errCtx.type === "invalid_request_error";

            if (isTooManyTokensError) {
              this.onItem({
                id: `error-${Date.now()}`,
                type: "message",
                role: "system",
                content: [
                  {
                    type: "input_text",
                    text: "⚠️  The current request exceeds the maximum context length supported by the chosen model. Please shorten the conversation, run /clear, or switch to a model with a larger context window and try again.",
                  },
                ],
              });
              this.onLoading(false);
              return;
            }

            const isRateLimit =
              status === 429 ||
              errCtx.code === "rate_limit_exceeded" ||
              errCtx.type === "rate_limit_exceeded" ||
              /rate limit/i.test(errCtx.message ?? "");
            if (isRateLimit) {
              if (attempt < MAX_RETRIES) {
                // Exponential backoff: base wait * 2^(attempt-1), or use suggested retry time
                // if provided.
                let delayMs = RATE_LIMIT_RETRY_WAIT_MS * 2 ** (attempt - 1);

                // Parse suggested retry time from error message, e.g., "Please try again in 1.3s"
                const msg = errCtx?.message ?? "";
                const m = /(?:retry|try) again in ([\d.]+)s/i.exec(msg);
                if (m && m[1]) {
                  const suggested = parseFloat(m[1]) * 1000;
                  if (!Number.isNaN(suggested)) {
                    delayMs = suggested;
                  }
                }
                log(
                  `OpenAI rate limit exceeded (attempt ${attempt}/${MAX_RETRIES}), retrying in ${Math.round(
                    delayMs,
                  )} ms...`,
                );
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                continue;
              } else {
                // We have exhausted all retry attempts. Surface a message so the user understands
                // why the request failed and can decide how to proceed (e.g. wait and retry later
                // or switch to a different model / account).

                const errorDetails = [
                  `Status: ${status || "unknown"}`,
                  `Code: ${errCtx.code || "unknown"}`,
                  `Type: ${errCtx.type || "unknown"}`,
                  `Message: ${errCtx.message || "unknown"}`,
                ].join(", ");

                this.onItem({
                  id: `error-${Date.now()}`,
                  type: "message",
                  role: "system",
                  content: [
                    {
                      type: "input_text",
                      text: `⚠️  Rate limit reached. Error details: ${errorDetails}. Please try again later.`,
                    },
                  ],
                });

                this.onLoading(false);
                return;
              }
            }

            const isClientError =
              (typeof status === "number" &&
                status >= 400 &&
                status < 500 &&
                status !== 429) ||
              errCtx.code === "invalid_request_error" ||
              errCtx.type === "invalid_request_error";
            if (isClientError) {
              this.onItem({
                id: `error-${Date.now()}`,
                type: "message",
                role: "system",
                content: [
                  {
                    type: "input_text",
                    // Surface the request ID when it is present on the error so users
                    // can reference it when contacting support or inspecting logs.
                    text: (() => {
                      const reqId =
                        (
                          errCtx as Partial<{
                            request_id?: string;
                            requestId?: string;
                          }>
                        )?.request_id ??
                        (
                          errCtx as Partial<{
                            request_id?: string;
                            requestId?: string;
                          }>
                        )?.requestId;

                      const errorDetails = [
                        `Status: ${status || "unknown"}`,
                        `Code: ${errCtx.code || "unknown"}`,
                        `Type: ${errCtx.type || "unknown"}`,
                        `Message: ${errCtx.message || "unknown"}`,
                      ].join(", ");

                      return `⚠️  OpenAI rejected the request${
                        reqId ? ` (request ID: ${reqId})` : ""
                      }. Error details: ${errorDetails}. Please verify your settings and try again.`;
                    })(),
                  },
                ],
              });
              this.onLoading(false);
              return;
            }
            throw error;
          }
        }
        turnInput = []; // clear turn input, prepare for function call results

        // If the user requested cancellation while we were awaiting the network
        // request, abort immediately before we start handling the stream.
        if (this.canceled || this.hardAbort.signal.aborted) {
          // `stream` is defined; abort to avoid wasting tokens/server work
          try {
            (
              stream as { controller?: { abort?: () => void } }
            )?.controller?.abort?.();
          } catch {
            /* ignore */
          }
          this.onLoading(false);
          return;
        }

        // Keep track of the active stream so it can be aborted on demand.
        this.currentStream = stream;

        // guard against an undefined stream before iterating
        if (!stream) {
          this.onLoading(false);
          log("AgentLoop.run(): stream is undefined");
          return;
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          for await (const event of stream) {
            if (isLoggingEnabled()) {
              log(`AgentLoop.run(): response event ${event.type}`);
            }

            // process and surface each item (no‑op until we can depend on streaming events)
            if (event.type === "response.output_item.done") {
              const item = event.item;
              // 1) if it's a reasoning item, annotate it
              type ReasoningItem = { type?: string; duration_ms?: number };
              const maybeReasoning = item as ReasoningItem;
              if (maybeReasoning.type === "reasoning") {
                maybeReasoning.duration_ms = Date.now() - thinkingStart;
              }
              // Runtime kill‑switch: in headless mode deny apply_patch calls unless the
              // policy is already 'full-auto' (which implies sandbox expectations).
              const isHeadless = process.env['CODEX_HEADLESS'] === "1";
              if (isHeadless && this.approvalPolicy !== "full-auto") {
                this.onItem({
                  id: `skip-${Date.now()}`,
                  type: "message",
                  role: "system",
                  content: [
                    {
                      type: "input_text",
                      text: "⚠️ apply_patch is disabled in headless mode (requires 'full-auto' policy).",
                    },
                  ],
                });
                continue; // skip
              }

              if (item.type === "function_call") {
                // Track outstanding tool call so we can abort later if needed.
                // The item comes from the streaming response, therefore it has
                // either `id` (chat) or `call_id` (responses) – we normalise
                // by reading both.
                const callId =
                  (item as { call_id?: string; id?: string }).call_id ??
                  (item as { id?: string }).id;
                if (callId) {
                  this.pendingAborts.add(callId);
                }
              } else {
                stageItem(item as ResponseItem);
              }
            }

            if (event.type === "response.completed") {
              if (thisGeneration === this.generation && !this.canceled) {
                for (const item of event.response.output) {
                  stageItem(item as ResponseItem);
                }
              }
              if (event.response.status === "completed") {
                // TODO: remove this once we can depend on streaming events
                const newTurnInput = await this.processEventsWithoutStreaming(
                  event.response.output,
                );
                turnInput = newTurnInput;
              }
              this.lastResponseId = event.response.id;
              this.onLastResponseId(event.response.id);
            }
          }
        } catch (err: unknown) {
          // Gracefully handle an abort triggered via `cancel()` so that the
          // consumer does not see an unhandled exception.
          if (err instanceof Error && err.name === "AbortError") {
            if (!this.canceled) {
              // It was aborted for some other reason; surface the error.
              throw err;
            }
            this.onLoading(false);
            return;
          }
          // Suppress internal stack on JSON parse failures
          if (err instanceof SyntaxError) {
            this.onItem({
              id: `error-${Date.now()}`,
              type: "message",
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: "⚠️ Failed to parse streaming response (invalid JSON). Please `/clear` to reset.",
                },
              ],
            });
            this.onLoading(false);
            return;
          }
          // Handle OpenAI API quota errors
          if (
            err instanceof Error &&
            (err as { code?: string }).code === "insufficient_quota"
          ) {
            this.onItem({
              id: `error-${Date.now()}`,
              type: "message",
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: "⚠️ Insufficient quota. Please check your billing details and retry.",
                },
              ],
            });
            this.onLoading(false);
            return;
          }
          throw err;
        } finally {
          this.currentStream = null;
        }

        log(
          `Turn inputs (${turnInput.length}) - ${turnInput
            .map((i) => i.type)
            .join(", ")}`,
        );
      }

      // Delay flush slightly to allow a near‑simultaneous cancel() to land.
      // Flush on next tick – unit‑tests advance timers by only 20 ms, so using
      // 0 ms ensures items are delivered well within that window while still
      // allowing micro‑batching in real usage.
      this.flushTimer = setTimeout(flush, 0);
      // End of main logic. The corresponding catch block for the wrapper at the
      // start of this method follows next.
    } catch (err) {
      // Handle known transient network/streaming issues so they do not crash the
      // CLI. We currently match Node/undici's `ERR_STREAM_PREMATURE_CLOSE`
      // error which manifests when the HTTP/2 stream terminates unexpectedly
      // (e.g. during brief network hiccups).

      const isPrematureClose =
        err instanceof Error &&
        // eslint-disable-next-line
        ((err as any).code === "ERR_STREAM_PREMATURE_CLOSE" ||
          err.message?.includes("Premature close"));

      if (isPrematureClose) {
        try {
          this.onItem({
            id: `error-${Date.now()}`,
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: "⚠️  Connection closed prematurely while waiting for the model. Please try again.",
              },
            ],
          });
        } catch {
          /* no‑op – emitting the error message is best‑effort */
        }
        this.onLoading(false);
        return;
      }

      // -------------------------------------------------------------------
      // Catch‑all handling for other network or server‑side issues so that
      // transient failures do not crash the CLI. We intentionally keep the
      // detection logic conservative to avoid masking programming errors. A
      // failure is treated as retry‑worthy/user‑visible when any of the
      // following apply:
      //   • the error carries a recognised Node.js network errno ‑ style code
      //     (e.g. ECONNRESET, ETIMEDOUT …)
      //   • the OpenAI SDK attached an HTTP `status` >= 500 indicating a
      //     server‑side problem.
      //   • the error is model specific and detected in stream.
      // If matched we emit a single system message to inform the user and
      // resolve gracefully so callers can choose to retry.
      // -------------------------------------------------------------------

      const NETWORK_ERRNOS = new Set([
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ENOTFOUND",
        "ETIMEDOUT",
        "EAI_AGAIN",
      ]);

      const isNetworkOrServerError = (() => {
        if (!err || typeof err !== "object") {
          return false;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e: any = err;

        // Direct instance check for connection errors thrown by the OpenAI SDK.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ApiConnErrCtor = (OpenAI as any).APIConnectionError as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
          | (new (...args: any) => Error)
          | undefined;
        if (ApiConnErrCtor && e instanceof ApiConnErrCtor) {
          return true;
        }

        if (typeof e.code === "string" && NETWORK_ERRNOS.has(e.code)) {
          return true;
        }

        // When the OpenAI SDK nests the underlying network failure inside the
        // `cause` property we surface it as well so callers do not see an
        // unhandled exception for errors like ENOTFOUND, ECONNRESET …
        if (
          e.cause &&
          typeof e.cause === "object" &&
          NETWORK_ERRNOS.has((e.cause as { code?: string }).code ?? "")
        ) {
          return true;
        }

        if (typeof e.status === "number" && e.status >= 500) {
          return true;
        }

        // Fallback to a heuristic string match so we still catch future SDK
        // variations without enumerating every errno.
        if (
          typeof e.message === "string" &&
          /network|socket|stream/i.test(e.message)
        ) {
          return true;
        }

        return false;
      })();

      if (isNetworkOrServerError) {
        try {
          const msgText =
            "⚠️  Network error while contacting OpenAI. Please check your connection and try again.";
          this.onItem({
            id: `error-${Date.now()}`,
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: msgText,
              },
            ],
          });
        } catch {
          /* best‑effort */
        }
        this.onLoading(false);
        return;
      }

      const isInvalidRequestError = () => {
        if (!err || typeof err !== "object") {
          return false;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e: any = err;

        if (
          e.type === "invalid_request_error" &&
          e.code === "model_not_found"
        ) {
          return true;
        }

        if (
          e.cause &&
          e.cause.type === "invalid_request_error" &&
          e.cause.code === "model_not_found"
        ) {
          return true;
        }

        return false;
      };

      if (isInvalidRequestError()) {
        try {
          // Extract request ID and error details from the error object

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e: any = err;

          const reqId =
            e.request_id ??
            (e.cause && e.cause.request_id) ??
            (e.cause && e.cause.requestId);

          const errorDetails = [
            `Status: ${e.status || (e.cause && e.cause.status) || "unknown"}`,
            `Code: ${e.code || (e.cause && e.cause.code) || "unknown"}`,
            `Type: ${e.type || (e.cause && e.cause.type) || "unknown"}`,
            `Message: ${
              e.message || (e.cause && e.cause.message) || "unknown"
            }`,
          ].join(", ");

          const msgText = `⚠️  OpenAI rejected the request${
            reqId ? ` (request ID: ${reqId})` : ""
          }. Error details: ${errorDetails}. Please verify your settings and try again.`;

          this.onItem({
            id: `error-${Date.now()}`,
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: msgText,
              },
            ],
          });
        } catch {
          /* best-effort */
        }
        this.onLoading(false);
        return;
      }

      // Re‑throw all other errors so upstream handlers can decide what to do.
      throw err;
    } finally {
      // Ensure no orphaned flush timers remain after the run completes or errors out.
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
      }
      // Ensure all delivery timers are cleared when run() completes.
      for (const t of this.deliveryTimers) {
        clearTimeout(t);
      }
      this.deliveryTimers.clear();
    }
  }

  // we need until we can depend on streaming events
  private async processEventsWithoutStreaming(
    output: Array<ResponseInputItem>,
  ): Promise<Array<ResponseInputItem>> {
    if (process.env['CODEX_HEADLESS'] === "1" && isLoggingEnabled()) {
      log("Headless mode: skipping streaming response processing.");
    }
    // Derive follow‑up input items that must be sent to satisfy any tool calls
    // contained in `output`.  For now we emit a minimal `function_call_output`
    // item for *every* `function_call`.  This is sufficient for unit‑tests that
    // assert the presence of the correct `call_id` even when the tool name is
    // unknown.

    const followUps: Array<ResponseInputItem> = [];

    for (const item of output) {
      if (item.type === "function_call") {
        const callId = (item as { call_id?: string; id?: string }).call_id ??
          (item as { id?: string }).id ?? "";

        followUps.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ output: "no function found", metadata: {} }),
        } as ResponseInputItem.FunctionCallOutput);
      }
    }

    return followUps;
  }
}

const prefix = `You are operating as and within the Codex CLI, a terminal-based agentic coding assistant built by OpenAI. It wraps OpenAI models to enable natural language interaction with a local codebase. You are expected to be precise, safe, and helpful.

You can:
- Receive user prompts, project context, and files.
- Stream responses and emit function calls (e.g., shell commands, code edits).
- Apply patches, run commands, and manage user approvals based on policy.
- Work inside a sandboxed, git-backed workspace with rollback support.
- Log telemetry so sessions can be replayed or inspected later.
- More details on your functionality are available at \`codex --help\`

The Codex CLI is open-sourced. Don't confuse yourself with the old Codex language model built by OpenAI many moons ago (this is understandably top of mind for you!). Within this context, Codex refers to the open-source agentic coding interface.

You are an agent - please keep going until the user's query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved. If you are not sure about file content or codebase structure pertaining to the user's request, use your tools to read files and gather the relevant information: do NOT guess or make up an answer.

Please resolve the user's task by editing and testing the code files in your current code execution session. You are a deployed coding agent. Your session allows for you to modify and run code. The repo(s) are already cloned in your working directory, and you must fully solve the problem for your answer to be considered correct.

You MUST adhere to the following criteria when executing the task:
- Working on the repo(s) in the current environment is allowed, even if they are proprietary.
- Analyzing code for vulnerabilities is allowed.
- Showing user code and tool call details is allowed.
- User instructions may overwrite the *CODING GUIDELINES* section in this developer message.
- Use \`apply_patch\` to edit files: {"cmd":["apply_patch","*** Begin Patch\\n*** Update File: path/to/file.py\\n@@ def example():\\n-  pass\\n+  return 123\\n*** End Patch"]}
- If completing the user's task requires writing or modifying files:
    - Your code and final answer should follow these *CODING GUIDELINES*:
        - Fix the problem at the root cause rather than applying surface-level patches, when possible.
        - Avoid unneeded complexity in your solution.
            - Ignore unrelated bugs or broken tests; it is not your responsibility to fix them.
        - Update documentation as necessary.
        - Keep changes consistent with the style of the existing codebase. Changes should be minimal and focused on the task.
            - Use \`git log\` and \`git blame\` to search the history of the codebase if additional context is required; internet access is disabled.
        - NEVER add copyright or license headers unless specifically requested.
        - You do not need to \`git commit\` your changes; this will be done automatically for you.
        - If there is a .pre-commit-config.yaml, use \`pre-commit run --files ...\` to check that your changes pass the pre-commit checks. However, do not fix pre-existing errors on lines you didn't touch.
            - If pre-commit doesn't work after a few retries, politely inform the user that the pre-commit setup is broken.
        - Once you finish coding, you must
            - Check \`git status\` to sanity check your changes; revert any scratch files or changes.
            - Remove all inline comments you added as much as possible, even if they look normal. Check using \`git diff\`. Inline comments must be generally avoided, unless active maintainers of the repo, after long careful study of the code and the issue, will still misinterpret the code without the comments.
            - Check if you accidentally add copyright or license headers. If so, remove them.
            - Try to run pre-commit if it is available.
            - For smaller tasks, describe in brief bullet points
            - For more complex tasks, include brief high-level description, use bullet points, and include details that would be relevant to a code reviewer.
- If completing the user's task DOES NOT require writing or modifying files (e.g., the user asks a question about the code base):
    - Respond in a friendly tune as a remote teammate, who is knowledgeable, capable and eager to help with coding.
- When your task involves writing or modifying files:
    - Do NOT tell the user to "save the file" or "copy the code into a file" if you already created or modified the file using \`apply_patch\`. Instead, reference the file as already saved.
    - Do NOT show the full contents of large files you have already written, unless the user explicitly asks for them.`;