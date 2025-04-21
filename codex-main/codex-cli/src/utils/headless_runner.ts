/* eslint-disable import/order */
import type { AppConfig } from "./config";
import type { ApprovalPolicy, ApplyPatchCommand } from "../approvals";
import type { ResponseItem, ResponseInputItem } from "openai/resources/responses/responses";

import { AgentLoop } from "./agent/agent-loop";
import { createInputItem } from "./input-utils";
import { ReviewDecision } from "./agent/review";
import { onExit } from "./terminal";
import readline from "node:readline";
import { debugLog } from "./debug";

// ---------------------------------------------------------------------------
// Types – a minimal subset for M1 while the full ipc_schema is still WIP.
// ---------------------------------------------------------------------------

type CodexToTangentMessage =
  | { type: "codex_ready" }
  | { type: "error"; message: string; details?: string }
  | { type: "status"; state: "idle" | "thinking" }
  | { type: "response_item"; item: ResponseItem };

// Placeholder for Tangent→Codex messages (will be expanded later).
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type TangentToCodexMessage = Record<string, unknown>;

function send(message: CodexToTangentMessage): void {
  process.stdout.write(JSON.stringify(message) + "\n");
}

/**
 * Headless JSON processing loop – STEP 3
 * Only sets up the NDJSON stream reader for now.
 */
export async function runHeadlessMode(params: {
  config: AppConfig;
  approvalPolicy: ApprovalPolicy;
  additionalWritableRoots: ReadonlyArray<string>;
}): Promise<void> {
  const { config, approvalPolicy, additionalWritableRoots } = params;

  // Send startup signal.
  send({ type: "codex_ready" });

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        // skip empty lines
        continue;
      }

      // Early exit command: plain "exit"
      if (trimmed.toLowerCase() === "exit") {
        break;
      }

      let msg: TangentToCodexMessage;
      try {
        msg = JSON.parse(trimmed) as TangentToCodexMessage;
      } catch (err) {
        send({ type: "error", message: "Failed to parse JSON", details: String(err) });
        continue;
      }

      // Check for {"exit": true}
      if (typeof msg === "object" && msg != null && "exit" in msg) {
        break;
      }

      // -------------------------------------------------------------------
      // Derive prompt + images from message
      // -------------------------------------------------------------------

      let promptText: string | undefined;
      let imagePaths: Array<string> = [];
      
      // Add fallback for legacy prompt format
      if (msg.prompt && !msg.type) {
        msg = {type: "user_prompt", content: msg.prompt, images: msg.images};
      }

      if (
        typeof msg === "object" &&
        msg != null &&
        "type" in msg &&
        (msg as Record<string, unknown>)["type"] === "user_prompt"
      ) {
        const m = msg as {
          type: string;
          content?: unknown;
          images?: unknown;
        };
        // Handle string or array content (from M1.md spec + Cursor)
        if (typeof m.content === "string") {
          promptText = m.content.trim() || undefined;
        } else if (Array.isArray(m.content)) {
          // accept Cursor‑style rich blocks
          const textBlock = m.content.find(
            (b: { type?: string; text?: string }) =>
              b.type === "input_text" || b.type === "text",
          );
          promptText = textBlock?.text;
        }
        if (Array.isArray(m.images)) {
          imagePaths = m.images.filter((p): p is string => typeof p === "string");
        }
      } else if (typeof msg === "object" && msg != null && "prompt" in msg) {
        const p = (msg as Record<string, unknown>)["prompt"];
        if (typeof p === "string" && p.trim().length > 0) {
          promptText = p;
        }
        const imgs = (msg as Record<string, unknown>)["images"];
        if (Array.isArray(imgs)) {
          imagePaths = imgs.filter((p): p is string => typeof p === "string");
        }
      }

      if (!promptText) {
        send({ type: "error", message: "Missing prompt text in message" });
        continue;
      }

      // -------------------------------------------------------------------
      // Build input item using helper
      // -------------------------------------------------------------------
      let inputItem: ResponseInputItem.Message;
      try {
        inputItem = await createInputItem(promptText, imagePaths);
      } catch (err) {
        send({
          type: "error",
          message: "Failed to create input item",
          details: String(err),
        });
        continue;
      }

      // -------------------------------------------------------------------
      // Run AgentLoop for this prompt (sequential)
      // -------------------------------------------------------------------

      const agent = new AgentLoop({
        model: config.model,
        config,
        instructions: config.instructions,
        approvalPolicy,
        additionalWritableRoots,
        onItem: (item: ResponseItem): void => {
          send({ type: "response_item", item });
          if (item.type !== "function_call") {
            // For the scope of M1 headless runner we treat completion of
            // each non‑tool item as end‑of‑turn and emit an idle status. The
            // UI/driver can ignore duplicates.
            send({ type: "status", state: "idle" });
          }
        },
        onLoading: (loading: boolean): void => {
          send({ type: "status", state: loading ? "thinking" : "idle" });
        },
        // In headless mode we never allow patches, but we auto‑approve shell
        // commands because `canAutoApprove` should have already OK'd them.
        // This confirmation handler is a fallback if something slips through.
        getCommandConfirmation: async (
          _command: Array<string>,
          applyPatch: ApplyPatchCommand | undefined,
        ): Promise<{ review: ReviewDecision }> => {
          if (applyPatch) {
            return { review: "deny" as unknown as ReviewDecision };
          }
          return { review: "approve" as unknown as ReviewDecision };
        },
        onLastResponseId: () => {
          /* no‑op */
        },
      });

      try {
        await agent.run([inputItem]);
      } catch (err) {
        send({ type: "error", message: "Agent error", details: String(err) });
      } finally {
        // Ensure we always signal that we're back to idle state, even when the
        // agent throws or is terminated early.
        debugLog('runHeadlessMode: sending idle status');
        send({ type: "status", state: "idle" });
        agent.terminate();
      }
    }
  } catch (err) {
    // Surface unexpected top‑level errors but keep the process alive so the
    // parent application can recover.
    send({ type: "error", message: "Unhandled headless error", details: String(err) });
  } finally {
    rl.close();
    onExit();
  }
}
