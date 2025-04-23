/*
 * Central helper for debug logging in headless‑JSON mode.
 *
 * Any internal diagnostics that should not be mixed into the NDJSON stream
 * written to stdout must use this helper.  Messages are printed to stderr only
 * when the environment variable `DEBUG_HEADLESS` is explicitly set to `"1"`.
 */

/**
 * Print debug information to stderr when DEBUG_HEADLESS=1.
 *
 * Usage:
 *   import { debugLog } from './utils/debug';
 *   debugLog('some', value);
 */
export const debugLog = (...args: unknown[]) =>
  (process.env['DEBUG_HEADLESS'] === '1' || 
   process.env['DEBUG_CANCEL'] === '1' || 
   process.env['DEBUG_TERMINATE'] === '1') &&
  console.error('[DEBUG]', ...args);
