/**
 * NDJSONParser – newline-delimited JSON parser with safety guards.
 * Emits:
 *   • object   – parsed JSON value
 *   • rawLine  – non-JSON line
 *   • error    – Error instance when something goes wrong
 */

import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'

export interface NDJSONParserOptions {
  maxLineBytes?: number // default 1 MiB
  bufferCapBytes?: number // default 2 MiB
}

export interface NDJSONParserEvents {
  object: (value: any) => void
  rawLine: (line: string) => void
  error: (err: Error) => void
}

const DEFAULT_MAX_LINE_BYTES = 1 * 1024 * 1024 // 1 MiB
const DEFAULT_BUFFER_CAP_BYTES = 2 * 1024 * 1024 // 2 MiB

export default class NDJSONParser extends EventEmitter {
  private buffer = ''
  private bomStripped = false
  private readonly maxLineBytes: number
  private readonly bufferCapBytes: number

  constructor(opts: NDJSONParserOptions = {}) {
    super()
    this.maxLineBytes = opts.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
    this.bufferCapBytes = opts.bufferCapBytes ?? DEFAULT_BUFFER_CAP_BYTES
  }

  /** Feed a chunk (Buffer or string) into the parser. */
  write(chunk: Buffer | string) {
    // Debug logging to see if we're receiving data
    if (process.env.DEBUG || process.env.INTEGRATION_TEST === '1') {
      console.log('[ndjson_parser] Received chunk:', typeof chunk, 
        typeof chunk === 'string' ? chunk : `<Buffer length: ${chunk.length}>`);
    }
    
    let data = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

    // Strip UTF-8 BOM once at the very start of the stream.
    if (!this.bomStripped) {
      if (data.charCodeAt(0) === 0xfeff) data = data.slice(1)
      this.bomStripped = true
    }

    if (process.env.DEBUG || process.env.INTEGRATION_TEST === '1') {
      console.log('[ndjson_parser] Data after UTF-8 conversion:', data);
    }

    this.buffer += data

    // Guard: if buffer large without newline it’s effectively one huge line.
    if (this.buffer.length > this.bufferCapBytes && !this.buffer.includes('\n')) {
      this.emitError(
        new Error(`NDJSON buffer exceeded ${this.bufferCapBytes} bytes — purged`)
      )
      this.buffer = ''
      return
    }

    let newlineIdx: number
    // eslint-disable-next-line no-cond-assign
    while ((newlineIdx = this.buffer.search(/\r?\n/)) !== -1) {
      const line = this.buffer.slice(0, newlineIdx)
      // Remove processed segment plus newline (and possible CR)
      const nextIndex = this.buffer[newlineIdx] === '\r' ? newlineIdx + 2 : newlineIdx + 1
      this.buffer = this.buffer.slice(nextIndex)

      this.processLine(line)

      if (this.buffer.length > this.bufferCapBytes) {
        this.emitError(
          new Error(`NDJSON buffer exceeded ${this.bufferCapBytes} bytes — purged`)
        )
        this.buffer = ''
      }
    }
  }

  private processLine(line: string) {
    if (process.env.DEBUG || process.env.INTEGRATION_TEST === '1') {
      console.log('[ndjson_parser] Processing line:', line);
    }
    
    const trimmed = line.trim()
    if (!trimmed) {
      if (process.env.DEBUG || process.env.INTEGRATION_TEST === '1') {
        console.log('[ndjson_parser] Empty line, skipping');
      }
      return;
    }

    if (Buffer.byteLength(trimmed, 'utf8') > this.maxLineBytes) {
      const preview = trimmed.slice(0, 120) + '…'
      console.log('[ndjson_parser] Oversized line detected:', preview);
      this.emitError(
        new Error(`Dropped oversized NDJSON line (>1 MiB). Preview: ${preview}`)
      )
      return
    }

    try {
      const value = JSON.parse(trimmed)
      console.log('[ndjson_parser] Successfully parsed JSON:', JSON.stringify(value));
      this.emit('object', value)
    } catch (err) {
      // Malformed JSON – surface both raw line and error.
      console.log('[ndjson_parser] Failed to parse JSON:', err);
      this.emit('rawLine', trimmed)
      const preview = trimmed.slice(0, 120)
      this.emitError(new Error('Malformed JSON line: ' + preview))
    }
  }

  private emitError(err: Error) {
    this.emit('error', err)
  }

  // Typed EventEmitter overloads ------------------------------------------

  override on<E extends keyof NDJSONParserEvents>(
    event: E,
    listener: NDJSONParserEvents[E]
  ): this {
    return super.on(event, listener as any)
  }

  override once<E extends keyof NDJSONParserEvents>(
    event: E,
    listener: NDJSONParserEvents[E]
  ): this {
    return super.once(event, listener as any)
  }

  override off<E extends keyof NDJSONParserEvents>(
    event: E,
    listener: NDJSONParserEvents[E]
  ): this {
    return super.off(event, listener as any)
  }
}
