#!/usr/bin/env node
/**
 * Packaged App Smoke Test for Tangent-Codex Integration
 *
 * This script performs a minimal smoke test of the Codex integration
 * in a packaged Electron app. It tests two critical aspects:
 * 1. Dark Launch: Codex process should not start when enableCodexIntegration is false
 * 2. File Transport: When enabled, Codex should work using file-based IPC on macOS
 *
 * Usage:
 *   node package-app-smoke-test.js
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

// Configuration
const TANGENT_DIR = path.join(__dirname, '..', 'Tangent-main', 'apps', 'tangent-electron');
const TIMEOUT_MS = 15000; // 15 seconds per test
const LOG_FILE = path.join(os.tmpdir(), `tangent-smoke-test-${Date.now()}.log`);

// Create log file
fs.writeFileSync(LOG_FILE, 'Packaged App Smoke Test Log\n', { flag: 'w' });

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(message);
}

/**
 * Launch the app with specified settings and environment
 */
async function launchApp(enableCodexIntegration, useFileTransport = false) {
  // Create a test workspace
  const TEST_WORKSPACE = path.join(os.tmpdir(), `tangent-smoke-test-workspace-${Date.now()}`);
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
  fs.writeFileSync(path.join(TEST_WORKSPACE, 'test-note.md'), '# Test Note\n\nThis is a test note for the smoke test.');
  log(`✅ Created test workspace at ${TEST_WORKSPACE}`);

  // Create test settings
  const SETTINGS_DIR = path.join(os.homedir(), '.tangent');
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });

  const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');
  const settings = {
    enableCodexIntegration,
    workspaces: [
      {
        path: TEST_WORKSPACE,
        name: 'Smoke Test Workspace'
      }
    ]
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  log(`✅ Created test settings with enableCodexIntegration=${enableCodexIntegration}`);

  // Set up file transport if needed
  let MOCK_CODEX_OUT = null;
  if (useFileTransport) {
    MOCK_CODEX_OUT = path.join(os.tmpdir(), `codex-smoke-test-${Date.now()}.ndjson`);
    fs.writeFileSync(MOCK_CODEX_OUT, '');
    log(`✅ Created mock Codex output file: ${MOCK_CODEX_OUT}`);
  }

  // Prepare environment variables
  const env = {
    ...process.env,
    TANGENT_TEST_MODE: '1',
    MOCK_CODEX_PATH: path.join(__dirname, 'mock_codex_headless.js'),
    INTEGRATION_TEST_USE_FILE_TRANSPORT: useFileTransport ? '1' : '0'
  };

  if (useFileTransport && MOCK_CODEX_OUT) {
    env.MOCK_CODEX_OUT = MOCK_CODEX_OUT;
    log(`✅ Setting environment variables for file transport:
  - INTEGRATION_TEST_USE_FILE_TRANSPORT=${env.INTEGRATION_TEST_USE_FILE_TRANSPORT}
  - MOCK_CODEX_OUT=${env.MOCK_CODEX_OUT}
  - MOCK_CODEX_PATH=${env.MOCK_CODEX_PATH}
`);
  }

  // Find the Electron executable
  let electronPath;
  if (process.platform === 'darwin') {
    // Use development electron for testing
    electronPath = path.join(TANGENT_DIR, 'node_modules', '.bin', 'electron');
  } else if (process.platform === 'win32') {
    electronPath = path.join(TANGENT_DIR, 'node_modules', '.bin', 'electron.cmd');
  } else {
    // Linux
    electronPath = path.join(TANGENT_DIR, 'node_modules', '.bin', 'electron');
  }

  if (!fs.existsSync(electronPath)) {
    throw new Error(`Electron executable not found: ${electronPath}`);
  }
  log(`✅ Found Electron executable: ${electronPath}`);

  // Launch the app
  log(`Launching app with enableCodexIntegration=${enableCodexIntegration}, useFileTransport=${useFileTransport}`);
  const tangentProcess = spawn(electronPath, [TANGENT_DIR], {
    env,
    stdio: 'pipe'
  });

  log(`✅ Launched Tangent process with PID: ${tangentProcess.pid}`);

  // Collect output and events
  let sawCodexStart = false;
  let sawCodexExit = false;
  let stdout = '';
  let stderr = '';

  tangentProcess.stdout.on('data', (data) => {
    const output = data.toString();
    stdout += output;

    if (output.includes('Codex process started')) {
      sawCodexStart = true;
      log('⚠️ Detected Codex process start');
    }

    if (output.includes('Codex process exited')) {
      sawCodexExit = true;
      log('⚠️ Detected Codex process exit');
    }
  });

  tangentProcess.stderr.on('data', (data) => {
    const output = data.toString();
    stderr += output;
  });

  // Set a timeout to kill the process
  const timeout = setTimeout(() => {
    log('⚠️ Test timeout reached, killing Tangent process');
    tangentProcess.kill('SIGKILL');
  }, TIMEOUT_MS);

  // Wait a bit for the app to initialize
  await new Promise(resolve => setTimeout(resolve, 7000));

  // Send SIGTERM to initiate graceful shutdown
  log('Sending SIGTERM to Tangent process');
  tangentProcess.kill('SIGTERM');

  // Wait for process to exit
  await new Promise((resolve) => {
    tangentProcess.on('exit', (code, signal) => {
      clearTimeout(timeout);
      log(`Tangent process exited with code ${code} and signal ${signal}`);
      resolve();
    });
  });

  // Check file transport output if used
  let fileTransportOutput = '';
  if (useFileTransport && MOCK_CODEX_OUT && fs.existsSync(MOCK_CODEX_OUT)) {
    fileTransportOutput = fs.readFileSync(MOCK_CODEX_OUT, 'utf8');
    if (fileTransportOutput.includes('codex_ready')) {
      log('⚠️ Found codex_ready message in file transport');
      sawCodexStart = true;
    }

    // Cleanup
    try {
      fs.unlinkSync(MOCK_CODEX_OUT);
    } catch (err) {
      log(`Warning: Could not delete ${MOCK_CODEX_OUT}: ${err.message}`);
    }
  }

  return {
    sawCodexStart,
    sawCodexExit,
    stdout,
    stderr,
    fileTransportOutput
  };
}

async function runTests() {
  try {
    log('Starting packaged app smoke tests');
    log(`Tangent directory: ${TANGENT_DIR}`);

    // Verify that the tangent-electron directory exists
    if (!fs.existsSync(TANGENT_DIR)) {
      throw new Error(`Tangent directory not found: ${TANGENT_DIR}`);
    }
    log('✅ Tangent directory exists');

    // Test 1: Dark Launch - Codex should NOT start when enableCodexIntegration is false
    log('\n--- TEST 1: Dark Launch (enableCodexIntegration=false) ---');
    const darkLaunchResult = await launchApp(false, false);

    // Report results for test 1
    if (!darkLaunchResult.sawCodexStart) {
      log('✅ DARK LAUNCH TEST PASSED: Codex process did not start when enableCodexIntegration=false');
    } else {
      log('❌ DARK LAUNCH TEST FAILED: Codex process started despite enableCodexIntegration=false');
      process.exit(1);
    }

    // Test 2: File Transport - Codex should start and communicate via file when enabled
    if (process.platform === 'darwin') {
      log('\n--- TEST 2: File Transport on macOS ---');
      const fileTransportResult = await launchApp(true, true);

      // Report results for test 2
      if (fileTransportResult.sawCodexStart) {
        log('✅ FILE TRANSPORT TEST PASSED: Codex process started with file transport');
      } else {
        log('❌ FILE TRANSPORT TEST FAILED: Codex process did not start with file transport');
        process.exit(1);
      }
    } else {
      log('\n--- TEST 2: File Transport (SKIPPED - only runs on macOS) ---');
    }

    log('\nAll smoke tests completed successfully!');
    return true;
  } catch (error) {
    log(`❌ ERROR: ${error.message}`);
    log(error.stack);
    process.exit(1);
  }
}

runTests().catch(err => {
  log(`Unhandled error: ${err.message}`);
  log(err.stack);
  process.exit(1);
});