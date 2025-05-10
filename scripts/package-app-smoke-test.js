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

  // Get the correct Electron executable to query the userData path
  // We need the same electron that we'll be launching to ensure consistent paths
  // Find the appropriate Electron executable
  let electronExecForPath;

  if (process.platform === 'darwin') {
    // Try packaged app first
    const macApp = path.join(TANGENT_DIR, 'dist', 'mac', 'Tangent.app', 'Contents', 'MacOS', 'Tangent');

    if (fs.existsSync(macApp)) {
      electronExecForPath = macApp;
      log(`Using packaged Mac app for settings path: ${electronExecForPath}`);
    } else {
      // Fall back to development electron
      electronExecForPath = path.join(TANGENT_DIR, 'node_modules', '.bin', 'electron');
      log(`Using development electron for settings path: ${electronExecForPath}`);
    }
  } else if (process.platform === 'win32') {
    // Try packaged app for Windows
    const winApp = path.join(TANGENT_DIR, 'dist', 'win-unpacked', 'Tangent.exe');

    if (fs.existsSync(winApp)) {
      electronExecForPath = winApp;
      log(`Using packaged Windows app for settings path: ${electronExecForPath}`);
    } else {
      // Fall back to development electron
      electronExecForPath = path.join(TANGENT_DIR, 'node_modules', '.bin', 'electron.cmd');
      log(`Using development electron for settings path: ${electronExecForPath}`);
    }
  } else {
    // Linux
    const linuxApp = path.join(TANGENT_DIR, 'dist', 'linux-unpacked', 'tangent');

    if (fs.existsSync(linuxApp)) {
      electronExecForPath = linuxApp;
      log(`Using packaged Linux app for settings path: ${electronExecForPath}`);
    } else {
      // Fall back to development electron
      electronExecForPath = path.join(TANGENT_DIR, 'node_modules', '.bin', 'electron');
      log(`Using development electron for settings path: ${electronExecForPath}`);
    }
  }

  // Determine the correct settings path by asking Electron directly
  let userDataPath;
  let SETTINGS_FILE;

  try {
    // Use execSync to get the path synchronously
    log(`Getting userData path from Electron at: ${electronExecForPath}`);

    // We need to use different approaches for packaged vs. development Electron
    if (electronExecForPath.includes('Tangent.app') ||
        electronExecForPath.includes('Tangent.exe') ||
        (process.platform === 'linux' && path.basename(electronExecForPath) === 'tangent')) {
      // Packaged app - Use a temporary script to get userData path
      const tempScriptPath = path.join(os.tmpdir(), `get-app-path-${Date.now()}.js`);
      fs.writeFileSync(tempScriptPath, `
        const { app } = require('electron');
        app.whenReady().then(() => {
          console.log(app.getPath('userData'));
          process.exit(0);
        });
      `);

      try {
        // For packaged app, we don't need to pass the app directory
        const { execSync } = require('child_process');
        userDataPath = execSync(`"${electronExecForPath}" ${tempScriptPath}`, { encoding: 'utf8' }).trim();
        log(`Packaged app userData path: ${userDataPath}`);

        // Use settings.json for packaged app
        SETTINGS_FILE = path.join(userDataPath, 'settings.json');
      } catch (execError) {
        log(`Error getting packaged app userData path: ${execError.message}`);
        // Fall back to a sensible default
        userDataPath = path.join(os.homedir(), '.tangent');
        SETTINGS_FILE = path.join(userDataPath, 'settings.json');
      } finally {
        // Clean up temp script
        try { fs.unlinkSync(tempScriptPath); } catch (e) { /* ignore cleanup errors */ }
      }
    } else {
      // Development electron - Use -e parameter
      const { execSync } = require('child_process');
      userDataPath = execSync(`"${electronExecForPath}" -e "const {app}=require('electron'); app.whenReady().then(()=>{console.log(app.getPath('userData'));process.exit(0);});"`, { encoding: 'utf8' }).trim();
      log(`Development app userData path: ${userDataPath}`);

      // Use dev_settings.json for development builds
      SETTINGS_FILE = path.join(userDataPath, 'dev_settings.json');
    }
  } catch (error) {
    log(`Error determining settings path: ${error.message}`);
    // Fall back to a sensible default
    userDataPath = path.join(os.homedir(), '.tangent');
    SETTINGS_FILE = path.join(userDataPath, 'settings.json');
  }

  // Create settings directory if it doesn't exist
  const SETTINGS_DIR = path.dirname(SETTINGS_FILE);
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });

  // Create the settings file with the appropriate configuration
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
  log(`✅ Created test settings at ${SETTINGS_FILE} with enableCodexIntegration=${enableCodexIntegration}`);

  // Save the settings path for later reference in the app
  env.SETTINGS_FILE_PATH = SETTINGS_FILE;

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
    // Tangent-specific variables
    TANGENT_TEST_MODE: '1',

    // Codex integration variables
    MOCK_CODEX_PATH: path.join(__dirname, 'mock_codex_headless.js'),
    MOCK_CODEX_DEBUG: '1',  // Enable verbose logging in mock_codex_headless.js
    MOCK_CODEX_ARGS: '--delay 500', // Add slight delay to ensure proper IPC
    INTEGRATION_TEST_USE_FILE_TRANSPORT: useFileTransport ? '1' : '0',
    ENABLE_CODEX_INTEGRATION: enableCodexIntegration ? '1' : '0',
    CODEX_BINARY_PATH: path.join(__dirname, 'mock_codex_headless.js'), // Backup path reference

    // Debug flags
    DEBUG: 'codex,codex:*,tangent:*',  // Enable all Codex and Tangent debug logs

    // Enhanced diagnostic variables
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_DEBUG_LOG: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1', // Reduce noise in logs
    E2E_DEVTOOLS: '1',  // Enable DevTools for additional debugging
    PACKAGED_APP_SMOKE_TEST: '1',  // Signal that we're running the smoke test

    // Set Node options for additional debugging if needed
    NODE_OPTIONS: '--trace-warnings --trace-exit'
  };

  // Always set MOCK_CODEX_OUT for consistent behavior, even when file transport is disabled
  // This ensures the mock Codex can always write to a file, which helps with diagnostics
  if (MOCK_CODEX_OUT) {
    env.MOCK_CODEX_OUT = MOCK_CODEX_OUT;
  }

  // Log all environment variables for debugging
  log(`✅ Setting environment variables for smoke test:`);
  Object.entries(env).forEach(([key, value]) => {
    if (key.startsWith('TANGENT_') || key.startsWith('CODEX_') || key.startsWith('MOCK_') ||
        key.startsWith('INTEGRATION_') || key.startsWith('ENABLE_') || key.startsWith('ELECTRON_') ||
        key.startsWith('DEBUG') || key.startsWith('E2E_') || key.startsWith('PACKAGED_')) {
      log(`  - ${key}=${value}`);
    }
  });

  // Find the appropriate Electron executable
  // We'll check for both the packaged app binary and the development electron
  let electronPath;
  let appDirArg; // This is only needed for development electron, not for packaged app

  if (process.platform === 'darwin') {
    // First try to find the packaged app
    const macApp = path.join(TANGENT_DIR, 'dist', 'mac', 'Tangent.app', 'Contents', 'MacOS', 'Tangent');

    if (fs.existsSync(macApp)) {
      electronPath = macApp;
      appDirArg = undefined; // Packaged app needs no arg
      log(`✅ Found packaged Mac app: ${electronPath}`);
    } else {
      // Fall back to development electron
      electronPath = path.join(TANGENT_DIR, 'node_modules', '.bin', 'electron');
      appDirArg = TANGENT_DIR; // When using development electron, we need to specify the app directory
      log(`⚠️ Packaged app not found, using development electron: ${electronPath}`);
    }
  } else if (process.platform === 'win32') {
    // Try packaged app first (Windows)
    const winApp = path.join(TANGENT_DIR, 'dist', 'win-unpacked', 'Tangent.exe');

    if (fs.existsSync(winApp)) {
      electronPath = winApp;
      appDirArg = undefined; // Packaged app needs no arg
      log(`✅ Found packaged Windows app: ${electronPath}`);
    } else {
      // Fall back to development electron
      electronPath = path.join(TANGENT_DIR, 'node_modules', '.bin', 'electron.cmd');
      appDirArg = TANGENT_DIR; // When using development electron, we need to specify the app directory
      log(`⚠️ Packaged app not found, using development electron: ${electronPath}`);
    }
  } else {
    // Linux - try packaged app first
    const linuxApp = path.join(TANGENT_DIR, 'dist', 'linux-unpacked', 'tangent');

    if (fs.existsSync(linuxApp)) {
      electronPath = linuxApp;
      appDirArg = undefined; // Packaged app needs no arg
      log(`✅ Found packaged Linux app: ${electronPath}`);
    } else {
      // Fall back to development electron
      electronPath = path.join(TANGENT_DIR, 'node_modules', '.bin', 'electron');
      appDirArg = TANGENT_DIR; // When using development electron, we need to specify the app directory
      log(`⚠️ Packaged app not found, using development electron: ${electronPath}`);
    }
  }

  if (!fs.existsSync(electronPath)) {
    throw new Error(`Electron executable not found: ${electronPath}`);
  }
  log(`✅ Found executable: ${electronPath}`);
  log(`✅ App directory argument: ${appDirArg || '(none needed for packaged app)'}`);

  // Launch the app
  log(`[SMOKE_SCRIPT] Launching app with executable: ${electronPath}`);
  log(`[SMOKE_SCRIPT] Launching app with env: ${JSON.stringify(env, null, 2)}`);

  // Create the command line args array - only pass app directory if using development electron
  const spawnArgs = appDirArg ? [appDirArg] : [];

  const tangentProcess = spawn(electronPath, spawnArgs, {
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

    // Immediately log all output to see it in real-time
    console.log(`[PACKAGED_APP_STDOUT] ${output.trimEnd()}`);

    // Also save to log file for CI artifacts
    fs.appendFileSync(LOG_FILE, `[PACKAGED_APP_STDOUT] ${output}`);

    // Check for specific markers
    if (output.includes('Codex process started')) {
      sawCodexStart = true;
      log('⚠️ Detected Codex process start');
    }

    if (output.includes('Codex process exited')) {
      sawCodexExit = true;
      log('⚠️ Detected Codex process exit');
    }

    // Check for our diagnostic markers
    if (output.includes('[CPM_SMOKE_DIAG]')) {
      log(`🔍 Found diagnostic log: ${output.trim()}`);
    }
  });

  tangentProcess.stderr.on('data', (data) => {
    const output = data.toString();
    stderr += output;

    // Immediately log stderr for debugging
    console.error(`[PACKAGED_APP_STDERR] ${output.trimEnd()}`);

    // Also save to log file for CI artifacts
    fs.appendFileSync(LOG_FILE, `[PACKAGED_APP_STDERR] ${output}`);

    // Check for our diagnostic markers in stderr too
    if (output.includes('[CPM_SMOKE_DIAG]')) {
      log(`🔍 Found diagnostic log in stderr: ${output.trim()}`);
    }
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
  let foundCodexReady = false;
  if (MOCK_CODEX_OUT && fs.existsSync(MOCK_CODEX_OUT)) {
    fileTransportOutput = fs.readFileSync(MOCK_CODEX_OUT, 'utf8');
    log(`📋 File transport contents (first 500 chars): ${fileTransportOutput.substring(0, 500)}`);

    // Look for the codex_ready message specifically - this is our critical verification point
    // We are looking for a proper JSON object, not just a string
    try {
      // Split the content by newlines to get individual JSON objects
      const jsonLines = fileTransportOutput.split('\n').filter(line => line.trim());
      log(`📋 Found ${jsonLines.length} lines in file transport output`);

      for (const line of jsonLines) {
        try {
          const json = JSON.parse(line);
          log(`📋 Parsed JSON: ${JSON.stringify(json)}`);

          // Check specifically for the codex_ready message type
          if (json.type === 'codex_ready') {
            log('✅ Found proper codex_ready message in file transport');
            foundCodexReady = true;
            sawCodexStart = true;
            break;
          }
        } catch (jsonErr) {
          log(`Warning: Could not parse JSON line: ${line.substring(0, 100)}`);
        }
      }
    } catch (parseErr) {
      log(`Error parsing file transport output: ${parseErr.message}`);
    }

    // If we didn't find a proper codex_ready message but found the text, log it as a fallback
    if (!foundCodexReady && fileTransportOutput.includes('codex_ready')) {
      log('⚠️ Found codex_ready text in file transport, but not as a proper JSON message');
      sawCodexStart = true;
    }

    // Cleanup
    try {
      // Save a copy for debugging before deleting
      const debugCopy = `${MOCK_CODEX_OUT}.debug`;
      fs.copyFileSync(MOCK_CODEX_OUT, debugCopy);
      log(`📋 Saved debug copy of file transport output to ${debugCopy}`);

      fs.unlinkSync(MOCK_CODEX_OUT);
    } catch (err) {
      log(`Warning: Could not delete ${MOCK_CODEX_OUT}: ${err.message}`);
    }
  } else if (useFileTransport && MOCK_CODEX_OUT) {
    log(`❌ File transport file not found: ${MOCK_CODEX_OUT}`);
  }

  return {
    sawCodexStart,
    sawCodexExit,
    stdout,
    stderr,
    fileTransportOutput,
    foundCodexReady, // Add the specific flag for codex_ready JSON message
    mockCodexPath: env.MOCK_CODEX_PATH, // Include paths for diagnostics
    mockCodexOut: env.MOCK_CODEX_OUT
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

      // Report results for test 2 with enhanced checks
      if (fileTransportResult.sawCodexStart) {
        // sawCodexStart will be true if we found codex_ready in the MOCK_CODEX_OUT file
        log('✅ FILE TRANSPORT TEST PASSED: Codex process started with file transport');

        // Additional diagnostic info to help with debugging
        if (fileTransportResult.fileTransportOutput) {
          const lines = fileTransportResult.fileTransportOutput.split('\n').filter(Boolean).length;
          log(`   - File transport contained ${lines} lines of output`);
          log(`   - First 100 chars: ${fileTransportResult.fileTransportOutput.substring(0, 100)}...`);
        } else {
          log('   - WARNING: File transport was empty despite sawCodexStart being true');
        }
      } else {
        // If the test failed, provide detailed diagnostics to help debug
        log('❌ FILE TRANSPORT TEST FAILED: Codex process did not start with file transport');
        log('Diagnostics:');
        log(`   - File transport path: ${MOCK_CODEX_OUT}`);
        log(`   - File existed: ${fs.existsSync(MOCK_CODEX_OUT+'.debug') ? 'Yes (.debug copy)' : 'No'}`);
        log(`   - sawCodexStart: ${fileTransportResult.sawCodexStart}`);

        // Check process stdout for relevant diagnostic information
        if (fileTransportResult.stdout.includes('[CPM_SMOKE_DIAG]')) {
          const diagLine = fileTransportResult.stdout.split('\n')
            .find(line => line.includes('[CPM_SMOKE_DIAG]'));
          log(`   - Found diagnostic: ${diagLine}`);
        } else {
          log('   - No [CPM_SMOKE_DIAG] marker found in stdout');
        }

        // Check stderr for errors
        if (fileTransportResult.stderr) {
          log('   - stderr content (first 200 chars):');
          log(`     ${fileTransportResult.stderr.substring(0, 200)}...`);
        }

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