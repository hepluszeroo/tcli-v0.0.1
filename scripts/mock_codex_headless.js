#!/usr/bin/env node
/*
 * Mock replacement for the proprietary Codex binary used by Tangent. The
 * real binary talks NDJSON over std-in/out.  For the purposes of the
 * integration tests we only need a *tiny* subset of that behaviour:
 *
 *   • Immediately emit a `codex_ready` JSON object.
 *   • Optionally emit an oversize junk line so the Electron side can verify
 *     oversized-input handling (the line length is controlled by
 *     `--oversize <bytes>`).
 *   • Optionally delay the emission of further messages (`--delay <ms>`).
 *   • Emit every JSON literal that follows the flags on the command line –
 *     this is how the individual tests configure the exact message stream.
 *
 * Examples as used by the Playwright specs:
 *   node mock.js                                 # happy-path (ready + idle)
 *   node mock.js --oversize 1200000 {"type":"ok"}
 *   node mock.js --delay 1000 {"type":"hb"}
 *   node mock.js --out /tmp/codex-output.log     # use file transport
 *
 * NOTE: Stdout *only* ever contains well-formed JSON objects **or** the
 * single oversize junk line.  All diagnostic information goes to stderr so
 * it never interferes with the NDJSON parser in the Electron harness.
 *
 * WORKAROUND FOR ELECTRON+PLAYWRIGHT ON MACOS:
 * This script implements a dual transport mechanism (stdout + file) to handle
 * a specific issue in macOS when Electron is launched by Playwright. In this
 * scenario, the stdout.fd of child processes can be undefined, breaking
 * communication through stdio pipes. To work around this, we:
 *
 * 1. Accept a --out parameter or MOCK_CODEX_OUT environment variable pointing
 *    to a temporary file path
 * 2. Write all NDJSON messages to both stdout AND this file simultaneously
 * 3. The Electron process can then poll this file as a backup communication channel
 *
 * This behavior is controlled by the INTEGRATION_TEST_USE_FILE_TRANSPORT
 * environment variable:
 *   - '1': Enable file transport workaround
 *   - '0': Disable it (useful for debugging)
 *   - If not set: Automatically use file transport on macOS only
 *
 * TODO: This is a temporary workaround. File upstream bug reports with Electron
 * and Playwright to investigate the root cause of stdout.fd being undefined
 * when Electron is launched by Playwright on macOS.
 */

// Initialize debug logging file - This is only written to when DEBUG or MOCK_CODEX_DEBUG is enabled
const fs = require('fs');
const DEBUG = process.env.DEBUG?.includes('codex') || process.env.MOCK_CODEX_DEBUG === '1' || process.env.PLAYWRIGHT_IN_DOCKER === '1';
const logPath = '/tmp/mock-codex-debug.log';

// Only create debug log file when debug mode is on
if (DEBUG) {
  fs.writeFileSync(logPath, 'Mock Codex Debug Log\n', {flag: 'w'});
  fs.appendFileSync(logPath, `Process ID: ${process.pid}\n`);
  fs.appendFileSync(logPath, `Working directory: ${process.cwd()}\n`);
  fs.appendFileSync(logPath, `Args: ${JSON.stringify(process.argv)}\n`);
  fs.appendFileSync(logPath, `Script position: ${process.argv.indexOf(__filename)}\n`);
  fs.appendFileSync(logPath, `Path: ${__filename}\n`);
  fs.appendFileSync(logPath, `ELECTRON_RUN_AS_NODE: ${process.env.ELECTRON_RUN_AS_NODE}\n`);
  fs.appendFileSync(logPath, `MOCK_CODEX_DEBUG: ${process.env.MOCK_CODEX_DEBUG}\n`);
  fs.appendFileSync(logPath, `MOCK_CODEX_ARGS: ${process.env.MOCK_CODEX_ARGS}\n\n`);

  // Force-flush the log file to ensure it's written to disk
  try {
    fs.fsyncSync(fs.openSync(logPath, 'r+'));
  } catch (e) {
    // Ignore errors, this is just a best-effort
  }
}

// Startup debug logging - conditionally output this to help debug process launch issues
if (process.env.DEBUG?.includes('codex') || process.env.MOCK_CODEX_DEBUG === '1') {
  console.error('[mock-codex] Startup - process launched successfully!');
  console.error('[mock-codex] Process ID:', process.pid);
  console.error('[mock-codex] Working directory:', process.cwd());
  console.error('[mock-codex] Args:', process.argv);
  console.error('[mock-codex] Script position:', process.argv.indexOf(__filename));
  console.error('[mock-codex] Environment:', {
    ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE,
    MOCK_CODEX_DEBUG: process.env.MOCK_CODEX_DEBUG,
    MOCK_CODEX_ARGS: process.env.MOCK_CODEX_ARGS,
    PLAYWRIGHT_IN_DOCKER: process.env.PLAYWRIGHT_IN_DOCKER
  });
}

// -----------------------------------------------------------------------------
// CRITICAL FIX: Force flushing stdout to ensure messages are sent immediately
// -----------------------------------------------------------------------------
if (process.stdout.isTTY) {
  process.stdout.setRawMode(false);
}

// Ensure stderr is also flushed
if (process.stderr.isTTY) {
  process.stderr.setRawMode(false);
}

// Force immediate emission of test data, bypassing any stream buffering
// This is critical for the tests to see data immediately and we output it multiple ways
// to ensure it reaches the main process

// REMOVED: We no longer emit default messages here unconditionally
// This caused duplicate messages that confused the tests
// The proper startup sequence is now emitted conditionally below in section 3

// REMOVED: We no longer emit heartbeat messages that may interfere with tests
// These messages can confuse assertion checks that depend on specific message ordering

// Log to the debug file if debug mode is enabled
if (DEBUG) {
  fs.appendFileSync(logPath, 'Sent initial messages: codex_ready, status:idle\n');
}

// debugLog and errorLog functions for consistent logging
function debugLog(...a) {
  if (DEBUG) {
    console.error('[mock-codex]', ...a);
    fs.appendFileSync(logPath, `DEBUG: ${a.join(' ')}\n`);
  }
}
function errorLog(...a) {
  console.error('[mock-codex]', ...a);
  if (DEBUG) {
    fs.appendFileSync(logPath, `ERROR: ${a.join(' ')}\n`);
  }
}

// ---------------------------------------------------------------------------
// 1 · CLI parsing – super-minimal, just enough for the flags we need.
// ---------------------------------------------------------------------------
// Check for MOCK_CODEX_ARGS in environment as well
const envArgs = (process.env.MOCK_CODEX_ARGS || '').split(' ').filter(Boolean);
const cmdArgs = process.argv.slice(2);
const argv = [...envArgs, ...cmdArgs];

// Optional file sink passed via --out or environment
let outPath = process.env.MOCK_CODEX_OUT || null;

// Log file transport path for debugging
debugLog('MOCK_CODEX_OUT env var:', process.env.MOCK_CODEX_OUT);
if (DEBUG) {
  fs.appendFileSync(logPath, `MOCK_CODEX_OUT env var: ${process.env.MOCK_CODEX_OUT || 'not set'}\n`);
}

// Scan argv and cmdArgs explicitly for --out
const outArgIndex = process.argv.indexOf('--out');
if (outArgIndex !== -1 && outArgIndex < process.argv.length - 1) {
  outPath = process.argv[outArgIndex + 1];
  debugLog('Found --out in process.argv at index', outArgIndex, 'with value:', outPath);
  if (DEBUG) {
    fs.appendFileSync(logPath, `Found --out in process.argv at index ${outArgIndex} with value: ${outPath}\n`);
  }
}

// Also check cmdArgs
const cmdOutArgIndex = cmdArgs.indexOf('--out');
if (cmdOutArgIndex !== -1 && cmdOutArgIndex < cmdArgs.length - 1) {
  outPath = cmdArgs[cmdOutArgIndex + 1];
  debugLog('Found --out in cmdArgs at index', cmdOutArgIndex, 'with value:', outPath);
  if (DEBUG) {
    fs.appendFileSync(logPath, `Found --out in cmdArgs at index ${cmdOutArgIndex} with value: ${outPath}\n`);
  }
}

if (outPath) {
  debugLog('Final outPath:', outPath);
  if (DEBUG) {
    fs.appendFileSync(logPath, `Final outPath: ${outPath}\n`);
  }
}

debugLog('Combined args:', argv);

let oversizeBytes = 0;
let delayMs = 0;
const jsonLiterals = [];

for (let i = 0; i < argv.length; i++) {
  const tok = argv[i];

  if (tok === '--oversize') {
    if (i + 1 >= argv.length) {
      errorLog('ERROR: --oversize requires a numeric argument');
      process.exit(1);
    }
    oversizeBytes = parseInt(argv[++i], 10) || 0;
    if (oversizeBytes <= 0) {
      errorLog('ERROR: --oversize requires a positive integer');
      process.exit(1);
    }
    continue;
  }

  if (tok === '--delay') {
    if (i + 1 >= argv.length) {
      errorLog('ERROR: --delay requires a numeric argument');
      process.exit(1);
    }
    delayMs = parseInt(argv[++i], 10) || 0;
    if (delayMs < 0) {
      delayMs = 0;
    }
    continue;
  }

  if (tok === '--out') {
    if (i + 1 >= argv.length) {
      errorLog('ERROR: --out requires a path');
      process.exit(1);
    }
    outPath = argv[++i];
    continue;
  }

  // Anything that *looks* like JSON (starts with "{") is collected verbatim.
  if (tok.startsWith('{')) {
    jsonLiterals.push(tok);
    continue;
  }

  // Unknown token → just ignore (keeps the parser lenient).
  debugLog('WARNING: ignoring unknown token', tok);
}

// Log parsed args
debugLog('Parsed args', { oversizeBytes, delayMs, jsonLiterals, outPath });
if (DEBUG) {
  fs.appendFileSync(logPath, `Parsed args: ${JSON.stringify({ oversizeBytes, delayMs, jsonLiterals, outPath })}\n`);
}

// If we have an outPath, test write access immediately
if (outPath) {
  try {
    // First check for parent directory access
    const path = require('path');
    const dirPath = path.dirname(outPath);

    try {
      const dirStats = fs.statSync(dirPath);
      debugLog('Parent directory exists, mode:', dirStats.mode.toString(8));
    } catch (dirErr) {
      errorLog('Parent directory check failed:', dirErr.message);
    }

    // Try to create an empty file to verify permissions
    fs.writeFileSync(outPath, '');

    // Try appending a valid JSON line that the parser can handle
    fs.appendFileSync(outPath, '{"type":"file_check"}\n');
    debugLog('Successfully initialized outPath file:', outPath);
  } catch (e) {
    errorLog('ERROR writing to outPath:', outPath, e.message);
    // Don't fail - just log the error
  }
}

// ---------------------------------------------------------------------------
// 2 · Helper that prints a line to stdout (and ensures trailing newline).
// ---------------------------------------------------------------------------
/**
 * Sends a message line to both stdout and the file transport if enabled
 *
 * IMPORTANT: This is a critical function for the Electron-Playwright workaround
 * The file transport is required to handle stdout.fd === undefined issues
 * in macOS when Electron is launched by Playwright
 */
function send(line) {
  if (!line.endsWith('\n')) line += '\n';
  debugLog('Sending line:', line.substring(0, 100) + (line.length > 100 ? '...' : ''));

  // CRITICAL: Write to both stdout and outPath if specified
  process.stdout.write(line);
  try {
    if (typeof process.stdout.flush === 'function') process.stdout.flush();
  } catch (flushErr) {
    errorLog('Error flushing stdout:', flushErr.message);
  }

  if (outPath) {
    try {
      fs.appendFileSync(outPath, line);
      debugLog(`Successfully wrote ${line.length} bytes to file transport`);
    } catch (e) {
      // Detailed error logging
      errorLog(`Cannot write to file transport: ${e.message}`);
      if (DEBUG) {
        // More verbose diagnostics only in debug mode
        console.error('[mock-codex] File write error details:', {
          outPath,
          error: e.message,
          code: e.code
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3 · Emit the mandatory startup sequence conditionally
// ---------------------------------------------------------------------------
// For special command-line arguments:
// - Don't emit default sequence if we have oversize bytes option, as that's for the oversize test
// - Otherwise, only emit default sequence if no literals were supplied
if (oversizeBytes > 0) {
  debugLog('Oversize test mode - skipping default startup sequence');
} else if (jsonLiterals.length === 0) {
  debugLog('No JSON literals provided, sending default startup sequence');
  send(JSON.stringify({ type: 'codex_ready' }));
  // Emit an idle status so the happy-path test does not have to wait
  send(JSON.stringify({ type: 'status', state: 'idle' }));
}

// ---------------------------------------------------------------------------
// 4 · Emit optional oversize junk line – a repeating \"A\" pattern (fast).
// ---------------------------------------------------------------------------
if (oversizeBytes > 0) {
  debugLog(`Sending oversize junk line (${oversizeBytes} bytes)`);
  const junk = 'A'.repeat(oversizeBytes);
  send(junk); // The Electron side should treat this as an error.
}

// ---------------------------------------------------------------------------
// 5 · Emit the requested JSON rows. Honour the optional delay flag.
// ---------------------------------------------------------------------------
function enqueueMessages(msgs, delay) {
  if (msgs.length === 0) {
    debugLog('No messages to enqueue');
    return;
  }

  debugLog(`Enqueueing ${msgs.length} messages with delay ${delay}ms`);

  let idx = 0;
  const tick = () => {
    debugLog(`Sending message ${idx+1}/${msgs.length}`);
    send(msgs[idx]);
    idx += 1;
    if (idx >= msgs.length) {
      if (delay > 0) clearInterval(timer);
      debugLog('All messages sent');
      return;
    }
  };

  if (delay === 0) {
    debugLog('Sending all messages immediately (no delay)');
    msgs.forEach((msg, i) => {
      debugLog(`Sending message ${i+1}/${msgs.length}`);
      send(msg);
    });
  } else {
    debugLog(`Setting up interval timer for delayed messages (${delay}ms)`);
    var timer = setInterval(tick, delay);
  }
}

// Call the function to process any JSON literals from command line
enqueueMessages(jsonLiterals, delayMs);

// ---------------------------------------------------------------------------
// 6 · Echo any stdin back to stdout as NDJSON so the send-path can be tested.
// ---------------------------------------------------------------------------
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  const text = chunk.trim();
  if (!text) return;
  debugLog(`Received stdin: ${text}`);
  send(JSON.stringify({ type: 'echo', text }));
});

// Emit heartbeat messages every 1 second to help debug communication issues
const heartbeatInterval = setInterval(() => {
  send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
}, 1000);
// Make sure the interval doesn't keep Node process alive
heartbeatInterval.unref();

// Keep the process alive when there is a delay ticker. If there is no work
// left we simply idle – the Electron parent will terminate us when needed.
const keepAliveTimer = setInterval(() => {
  // Write diagnostic marker to log file if debug mode is on
  if (DEBUG) {
    fs.appendFileSync(logPath, `Still alive at ${new Date().toISOString()}\n`);
  }
}, 5000);
// Make sure the interval doesn't keep Node process alive
keepAliveTimer.unref();

/**
 * Handle shutdown signals gracefully
 * This is important for proper cleanup during Electron/Playwright tests
 */
function shutdown() {
  debugLog('Shutdown signal received');

  // Clear intervals to stop any ongoing heartbeats or timers
  clearInterval(heartbeatInterval);
  clearInterval(keepAliveTimer);

  process.exit(0);
}

// Register signal handlers
process.on('SIGTERM', () => {
  debugLog('SIGTERM received');
  shutdown();
});

process.on('SIGINT', () => {
  debugLog('SIGINT received');
  shutdown();
});

// Register unhandled exception handler to catch crashes
process.on('uncaughtException', (err) => {
  errorLog('Uncaught exception:', err);
  if (DEBUG) {
    fs.appendFileSync(logPath, `CRASH: ${err.stack || err.message}\n`);
  }
});

// Log that we've completed initialization
debugLog('Mock Codex initialization complete');
