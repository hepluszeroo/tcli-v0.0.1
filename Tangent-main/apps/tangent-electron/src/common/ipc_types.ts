// Common type & channel definitions for Tangent ↔ Codex IPC.
// NOTE: keep this file free of Electron or Node-specific imports so it can be
// consumed by both main-process and renderer bundles.

export enum CodexChannel {
  Start = 'codex:start',
  Stop = 'codex:stop',
  Send = 'codex:send',
  Message = 'codex:message',
  Status = 'codex:status',
  Error = 'codex:error',
  Exit = 'codex:exit'
}

// ----------------------------------------------------------------------------
// Message payloads
// ----------------------------------------------------------------------------

/** A very loose base – will be tightened once the full schema is frozen. */
export interface CodexMessageBase {
  type: string
  [key: string]: unknown
}

export type CodexMessage = CodexMessageBase

export interface CodexStatusPayload {
  running: boolean
  code?: number | null
  signal?: string | null
}

export interface CodexErrorPayload {
  message: string
}
