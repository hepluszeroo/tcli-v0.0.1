import { _electron, ElectronApplication } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

function fsExists(p: string): boolean {
  try { return fs.existsSync(p) } catch { return false }
}

export async function launchElectron(opts: {
  electronBinary: string
  buildDir: string
  mainEntry: string
  workspace?: string
  env: NodeJS.ProcessEnv
  timeout?: number
}): Promise<{ app: ElectronApplication; child?: any }> {
  const { buildDir, mainEntry, workspace, env } = opts

  // Define common flags that are always needed
  const commonFlags = [
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=0',
    '--disable-setuid-sandbox', // Additional sandbox flag for CI/Docker
    '--disable-dev-shm-usage', // Prevent issues with /dev/shm size in Docker
    '--disable-software-rasterizer', // Avoid GPU issues
    '--disable-accelerated-2d-canvas' // Avoid GPU issues
  ];
  
  // Special environment variables for Electron
  const electronEnv = {
    ...env,
    ELECTRON_ENABLE_LOGGING: '1',
    // IMPORTANT: Disable sandbox but DON'T set ELECTRON_RUN_AS_NODE
    ELECTRON_DISABLE_SANDBOX: '1'
  }

  // ---------------------------------------------------------------
  // Determine if we need to use file-based transport as a workaround for the
  // Electron stdout pipe bug. This can be controlled via the
  // INTEGRATION_TEST_USE_FILE_TRANSPORT environment variable.
  // ---------------------------------------------------------------
  const useFileTransport = process.env.INTEGRATION_TEST_USE_FILE_TRANSPORT === '1' ||
                          // Default to using file transport on macOS as that's where we've seen the issue
                          (process.platform === 'darwin' && process.env.INTEGRATION_TEST_USE_FILE_TRANSPORT !== '0');

  // Set environment variable for Electron process to read
  electronEnv.INTEGRATION_TEST_USE_FILE_TRANSPORT = useFileTransport ? '1' : '0';

  console.log('[electronHarness] File-based transport:', useFileTransport ? 'ENABLED' : 'DISABLED');

  let tmpOutPath: string | null = null;

  if (useFileTransport) {
    // ---------------------------------------------------------------
    // Temporary file path for Codex mock output (workaround for Electron
    // stdout pipe bug). The manager in main process will tail this file.
    // ---------------------------------------------------------------
    tmpOutPath = path.join(os.tmpdir(), `codex-${Date.now()}-${Math.random().toString(16).slice(2)}.ndjson`);

    // Explicitly create the file now to ensure it exists and has permissions
    try {
      // Create an empty file - don't add any comments as they cause NDJSON parse errors
      fs.writeFileSync(tmpOutPath, '');
      console.log('[electronHarness] Successfully created MOCK_CODEX_OUT file:', tmpOutPath);

      // Verify that the file was actually created
      const fileExists = fs.existsSync(tmpOutPath);
      console.log('[electronHarness] File exists check:', fileExists);

      // Check file permissions and size
      const stats = fs.statSync(tmpOutPath);
      console.log('[electronHarness] File stats:', {
        size: stats.size,
        mode: stats.mode.toString(8),
        uid: stats.uid,
        gid: stats.gid
      });
    } catch (err) {
      console.error('[electronHarness] ERROR creating MOCK_CODEX_OUT file:', err);
      // Don't throw, continue with the test
    }

    electronEnv.MOCK_CODEX_OUT = tmpOutPath;
    console.log('[electronHarness] Using MOCK_CODEX_OUT file:', tmpOutPath);

    // Ensure the variable is also present in the Node process that launches
    // Electron so Electron-main inherits it directly via process.env.
    process.env.MOCK_CODEX_OUT = tmpOutPath;
  }

  // -------------------------------------------------------------------
  // If using file transport, ensure the mock receives the --out <file> flag
  // via MOCK_CODEX_ARGS. Combine with any existing JSON-token args already present.
  // -------------------------------------------------------------------

  const existingArgs = (process.env.MOCK_CODEX_ARGS ?? '').trim();
  let finalMockArgs = existingArgs;

  // Only append the --out flag if we're using file transport
  if (useFileTransport && tmpOutPath) {
    const outFlag = `--out ${tmpOutPath}`;
    // Build the final argument string that includes the --out flag when file transport is enabled.
    // If the caller already provided some extra args via env we append the flag;
    // otherwise we start with just the flag.
    finalMockArgs = existingArgs ? `${existingArgs} ${outFlag}` : outFlag;
  }

  // Store it in both the environment we pass to Electron *and* in the current
  // process.env so any subsequent logic executed in this harness can see the up-to-date value.
  electronEnv.MOCK_CODEX_ARGS = finalMockArgs;
  process.env.MOCK_CODEX_ARGS = finalMockArgs;

  console.log('[electronHarness] Final MOCK_CODEX_ARGS:', finalMockArgs);

  // ---------------------------------------------------------------------
  // Guarantee that the Electron main process knows the *absolute* path to
  // a usable Node executable.  On macOS the helper process inherits a very
  // limited PATH that is often missing Homebrew / nvm locations, causing
  // `spawn('node', …)` to throw ENOENT.  By forwarding the host’s
  // `process.execPath` (which is always an absolute path to Node when this
  // harness itself runs under Node) we make the binary discoverable without
  // touching global PATH.
  // ---------------------------------------------------------------------

  if (!electronEnv.NODE_BINARY) {
    electronEnv.NODE_BINARY = process.execPath
  }
  
  // Make sure MOCK_CODEX_PATH is available to the Electron process
  if (process.env.MOCK_CODEX_PATH) {
    console.log('[electronHarness] Forwarding MOCK_CODEX_PATH:', process.env.MOCK_CODEX_PATH);
    electronEnv.MOCK_CODEX_PATH = process.env.MOCK_CODEX_PATH;
  }
  
  // -----------------------------------------------------------------
  // Extract the JSON literals from the final mock-args we just built so
  // the Electron main process can parse them without splitting on the
  // `--out` flag.
  // -----------------------------------------------------------------
  if (electronEnv.MOCK_CODEX_ARGS) {
    console.log('[electronHarness] Forwarding MOCK_CODEX_ARGS:', electronEnv.MOCK_CODEX_ARGS);

    const extraJsonTokens = electronEnv.MOCK_CODEX_ARGS.match(/({[^}]+})/g) ?? [];
    if (extraJsonTokens.length > 0) {
      console.log('[electronHarness] Extracted JSON tokens:', extraJsonTokens);
      electronEnv.MOCK_CODEX_JSON_TOKENS = JSON.stringify(extraJsonTokens);
    }
  }
  
  // Additional Docker environment variables
  if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
    console.log('[electronHarness] Running in Docker container');

    // Verify workspace directory and settings in Docker
    try {
      const fs = require('fs');

      // Verify workspace directory exists
      const workspacePath = '/repo/Tangent-main/apps/IntegrationTestWorkspace';
      const tangentDirPath = `${workspacePath}/.tangent`;
      const settingsPath = `${tangentDirPath}/settings.json`;

      console.log(`[electronHarness] Verifying Docker workspace at: ${workspacePath}`);
      if (fs.existsSync(workspacePath)) {
        console.log(`[electronHarness] ✅ Workspace directory exists`);
      } else {
        console.log(`[electronHarness] ❌ Workspace directory missing - creating it now`);
        try {
          fs.mkdirSync(workspacePath, { recursive: true });
        } catch (e) {
          console.error(`[electronHarness] Failed to create workspace directory:`, e);
        }
      }

      if (fs.existsSync(tangentDirPath)) {
        console.log(`[electronHarness] ✅ .tangent directory exists`);
      } else {
        console.log(`[electronHarness] ❌ .tangent directory missing - creating it now`);
        try {
          fs.mkdirSync(tangentDirPath, { recursive: true });
        } catch (e) {
          console.error(`[electronHarness] Failed to create .tangent directory:`, e);
        }
      }

      if (fs.existsSync(settingsPath)) {
        console.log(`[electronHarness] ✅ settings.json exists`);
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          console.log(`[electronHarness] Settings content:`, settings);
          if (settings.enableCodexIntegration !== true) {
            console.log(`[electronHarness] ⚠️ enableCodexIntegration not true - fixing it`);
            settings.enableCodexIntegration = true;
            fs.writeFileSync(settingsPath, JSON.stringify(settings));
          }
        } catch (e) {
          console.error(`[electronHarness] Error reading/writing settings:`, e);
        }
      } else {
        console.log(`[electronHarness] ❌ settings.json missing - creating it now`);
        try {
          fs.writeFileSync(settingsPath, JSON.stringify({ enableCodexIntegration: true }));
        } catch (e) {
          console.error(`[electronHarness] Failed to create settings.json:`, e);
        }
      }
    } catch (e) {
      console.error(`[electronHarness] Error verifying workspace:`, e);
    }

    // (PathHelpers now centralize MOCK_CODEX_PATH; no manual override needed here)

    Object.assign(electronEnv, {
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      ELECTRON_ENABLE_STACK_DUMPING: '1',
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_DISABLE_SANDBOX: '1',
      ELECTRON_RUNNING_IN_DOCKER: '1', // Additional flag to indicate Docker environment
      NODE_ENV: 'test',
      DISPLAY: ':99', // Ensure DISPLAY is set for Xvfb
      DEBUG: 'electron,electron:*,codex,main,tangent,workspace:*' // Enhanced debug logging with workspace info
    })
  }
  
  // Make sure we're NOT running as Node.js
  if ('ELECTRON_RUN_AS_NODE' in electronEnv) {
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    console.log('[electronHarness] Removed ELECTRON_RUN_AS_NODE to ensure running in Chromium mode');
  }

  // Ensure we're using the correct build directory that exists
  let actualBuildDir = buildDir;
  if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
    // In Docker, make sure we're using the tangent-electron/__build directory
    actualBuildDir = '/repo/Tangent-main/apps/tangent-electron/__build';
    console.log(`[electronHarness] Docker environment detected. Using build dir: ${actualBuildDir}`);
    
    // Check if directory exists
    try {
      const exists = fs.existsSync(actualBuildDir);
      console.log(`[electronHarness] Build directory exists: ${exists}`);
      if (!exists) {
        console.log(`[electronHarness] Fallback: checking symlink at ${buildDir}`);
        console.log(`[electronHarness] Symlink exists: ${fs.existsSync(buildDir)}`);
      }
    } catch (e) {
      console.error(`[electronHarness] Error checking build directory:`, e);
    }
  }

  // -------------------------------------------------------------------
  // Prepare final arg list: minimal required flags + entry script.
  // Playwright needs --remote-debugging-port=0 to capture the websocket.
  // Keep --no-sandbox / --disable-gpu for container stability.
  // -------------------------------------------------------------------
  const finalArgs = [
    ...commonFlags,
    path.join(actualBuildDir, 'bundle', 'main.js'),
    ...(workspace ? [workspace] : [])
  ]
  
  // Note: The main.js loaded here is now using the real preload.js bundle
  // which provides window.api.* interfaces needed by the Codex integration tests
  
  console.log('[electronHarness] Launching Electron with args:', finalArgs)
  console.log('[electronHarness] CWD:', actualBuildDir)

  // Add detailed diagnostic logging for the Electron binary
  console.log(`[electronHarness] Attempting to launch Electron. Effective executablePath: "${opts.electronBinary}"`)
  console.log(`[electronHarness] Does this path exist? ${require('fs').existsSync(opts.electronBinary)}`)

  if (require('fs').existsSync(opts.electronBinary)) {
    try {
      const stats = require('fs').statSync(opts.electronBinary);
      console.log('[electronHarness] Electron binary stats:', {
        size: stats.size,
        mode: stats.mode.toString(8),
        uid: stats.uid,
        gid: stats.gid,
        isExecutable: !!(stats.mode & 0o111)
      });
    } catch (err) {
      console.error('[electronHarness] Error getting Electron binary stats:', err);
    }
  }

  // Additional pre-launch verification for Docker
  if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
    try {
      // STEP 3: Remove all usage of _electron.executablePath() which doesn't exist in Playwright 1.52

      // Check if the workspace argument is correct
      if (workspace) {
        console.log(`[electronHarness] Workspace argument: "${workspace}"`);
        if (workspace !== '/repo/Tangent-main/apps/IntegrationTestWorkspace') {
          console.warn(`[electronHarness] ⚠️ Workspace argument doesn't match expected Docker path!`);
        }
      } else {
        console.warn(`[electronHarness] ⚠️ No workspace argument provided!`);
      }

      // Ensure Electron binary is executable one final time
      const fs = require('fs');
      if (fs.existsSync(opts.electronBinary)) {
        try {
          fs.chmodSync(opts.electronBinary, 0o755);
          console.log(`[electronHarness] Made Electron binary executable just before launch`);
        } catch (e) {
          console.error(`[electronHarness] Failed to chmod Electron binary:`, e);
        }
      }
    } catch (e) {
      console.error(`[electronHarness] Pre-launch verification error:`, e);
    }
  }

  try {
    // Super-comprehensive pre-launch diagnostics
    console.log(`[electronHarness] 🔍 PRE-LAUNCH DIAGNOSTICS 🔍`);
    console.log(`[electronHarness] 1. Electron binary path: ${opts.electronBinary}`);

    // Check binary existence and permissions
    const fs = require('fs');
    let binaryExists = false;
    let binaryExecutable = false;
    let binaryStats = null;

    try {
      binaryExists = fs.existsSync(opts.electronBinary);
      console.log(`[electronHarness]    - Binary exists: ${binaryExists}`);

      if (binaryExists) {
        binaryStats = fs.statSync(opts.electronBinary);
        binaryExecutable = !!(binaryStats.mode & 0o111);
        console.log(`[electronHarness]    - Binary stats:`, {
          size: binaryStats.size,
          mode: binaryStats.mode.toString(8),
          isExecutable: binaryExecutable,
          isFile: binaryStats.isFile(),
          isSymlink: binaryStats.isSymbolicLink()
        });

        // Attempt to make it executable if it's not
        if (!binaryExecutable) {
          console.log(`[electronHarness]    - Making binary executable...`);
          try {
            fs.chmodSync(opts.electronBinary, 0o755);
            binaryExecutable = true;
            console.log(`[electronHarness]    - Binary is now executable`);
          } catch (chmodErr) {
            console.error(`[electronHarness]    - Failed to make binary executable:`, chmodErr);
          }
        }
      }
    } catch (fsErr) {
      console.error(`[electronHarness]    - Error checking binary:`, fsErr);
    }

    // Emergency fallbacks if binary doesn't exist
    if (!binaryExists) {
      console.log(`[electronHarness] ⚠️ Primary binary NOT found, trying emergency fallbacks...`);

      const fallbackPaths = [
        '/repo/bin/electron',
        '/repo/node_modules/electron/dist/electron',
        '/repo/node_modules/.bin/electron',
        // Add additional fallbacks as needed
      ];

      for (const path of fallbackPaths) {
        try {
          if (fs.existsSync(path)) {
            console.log(`[electronHarness]    - Found fallback at ${path}`);
            // Update the binary path to use the fallback
            opts.electronBinary = path;
            fs.chmodSync(path, 0o755);
            console.log(`[electronHarness]    - Made fallback executable`);
            binaryExists = true;
            binaryExecutable = true;
            break;
          }
        } catch (fallbackErr) {
          console.error(`[electronHarness]    - Error with fallback ${path}:`, fallbackErr);
        }
      }
    }

    // Check directory structure
    console.log(`[electronHarness] 2. Directory structure:`);
    console.log(`[electronHarness]    - Current working directory: ${process.cwd()}`);
    console.log(`[electronHarness]    - Build directory: ${actualBuildDir}`);
    console.log(`[electronHarness]    - Main entry: ${path.join(actualBuildDir, 'bundle', 'main.js')}`);

    try {
      const mainEntryExists = fs.existsSync(path.join(actualBuildDir, 'bundle', 'main.js'));
      console.log(`[electronHarness]    - Main entry exists: ${mainEntryExists}`);
    } catch (dirErr) {
      console.error(`[electronHarness]    - Error checking main entry:`, dirErr);
    }

    // Check environment and arguments
    console.log(`[electronHarness] 3. Launch environment:`);
    // Print key environment variables without logging everything
    const importantVars = ['DISPLAY', 'ELECTRON_ENABLE_LOGGING', 'DEBUG', 'ELECTRON_DISABLE_SANDBOX'];
    importantVars.forEach(varName => {
      console.log(`[electronHarness]    - ${varName}: ${electronEnv[varName] || '(not set)'}`);
    });

    console.log(`[electronHarness] 4. Launch arguments: ${finalArgs.join(' ')}`);

    // Display server check
    if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
      console.log(`[electronHarness] 5. Display server check (Docker):`);
      try {
        const { execSync } = require('child_process');
        const xdpyinfo = execSync('xdpyinfo', { timeout: 2000 }).toString().substring(0, 500) + '...';
        console.log(`[electronHarness]    - xdpyinfo output: ${xdpyinfo}`);
      } catch (xdpyErr) {
        console.error(`[electronHarness]    - xdpyinfo error: ${xdpyErr.message}`);
        // If xdpyinfo fails, maybe DISPLAY isn't set or Xvfb isn't running
        console.log(`[electronHarness]    - Setting guaranteed DISPLAY=:99 for Electron launch`);
        electronEnv.DISPLAY = ':99';
      }
    }

    // Final pre-launch message
    console.log(`[electronHarness] 🚀 LAUNCHING ELECTRON with all safeguards in place 🚀`);
    if (!binaryExists) {
      console.error(`[electronHarness] ⚠️ WARNING: Electron binary NOT found, launch will likely fail!`);
    }

    // Wrap Playwright's _electron.launch in additional try-catch with diagnostics
    try {
      // Overridden timeout to give enough time in Docker
      const launchTimeout = process.env.PLAYWRIGHT_IN_DOCKER === '1' ? 90000 : 30000;
      console.log(`[electronHarness] Using launch timeout: ${launchTimeout}ms`);

      // STEP 4: Let Playwright choose the binary automatically
      const launchOptions: any = {
        cwd: actualBuildDir,
        args: finalArgs,
        env: electronEnv,
        timeout: launchTimeout
      };

      // Use the direct path to Electron binary in Docker, or the CLI script elsewhere
      if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
        // In Docker, directly use the symlink we've carefully maintained
        launchOptions.executablePath = '/repo/bin/electron';
        console.log(`[electronHarness] Docker environment: Using direct binary path: ${launchOptions.executablePath}`);
      } else {
        // In non-Docker environments, use the CLI script
        try {
          // Try to find the Electron CLI script
          const cliPath = require.resolve('electron/cli.js');
          launchOptions.executablePath = cliPath;
          console.log(`[electronHarness] Using Electron CLI script: ${cliPath}`);
        } catch (e) {
          console.log(`[electronHarness] Could not find Electron CLI script: ${e}`);
          // Fall back to the provided binary if the CLI script isn't found
          if (opts.electronBinary) {
            launchOptions.executablePath = opts.electronBinary;
            console.log(`[electronHarness] Falling back to provided binary: ${opts.electronBinary}`);
          } else {
            console.log(`[electronHarness] Using Playwright's bundled Electron (no executablePath specified)`);
          }
        }
      }

      const app = await _electron.launch(launchOptions);

    // Part IV: Add a timeout for electron.firstWindow() to catch potential hangs
    console.log('[electronHarness] Waiting for first window to load (timeout: 20s)...');
    try {
      const firstWindowTimeout = 20000; // 20 seconds
      const firstWindowPromise = app.firstWindow({ timeout: firstWindowTimeout });

      // Create a race between the firstWindow and a timeout
      const window = await Promise.race([
        firstWindowPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`[FATAL] Timed out waiting for first window after ${firstWindowTimeout}ms. Electron may be stuck launching.`));
          }, firstWindowTimeout);
        })
      ]);

      console.log('[electronHarness] First window loaded successfully!');
    } catch (windowError) {
      console.error('[electronHarness] Error getting first window:', windowError);
      // Collect additional diagnostics if available
      try {
        const pages = await app.context().pages();
        console.log(`[electronHarness] Found ${pages.length} pages/windows`);
      } catch (diagError) {
        console.error('[electronHarness] Could not get diagnostic page info:', diagError);
      }
      // Don't throw here - let the test continue and likely fail with a better error message
    }

    // Return the app interface (no child process handle needed)
    return { app };

    } catch (launchError) {
      console.error('[electronHarness] ❌ INNER ERROR DURING _electron.launch:', launchError);

      // Enhanced error diagnostics
      console.log('[electronHarness] 📊 ENHANCED ERROR DIAGNOSTICS:');

      // Check if it's a timeout error
      if (launchError.message?.includes('Timeout') || launchError.message?.includes('timeout')) {
        console.log('[electronHarness] ⏱️ This appears to be a TIMEOUT error');
        console.log('[electronHarness] - Possible causes:');
        console.log('[electronHarness]   1. Electron process crashed immediately after launch');
        console.log('[electronHarness]   2. Electron is taking too long to start (increase timeout)');
        console.log('[electronHarness]   3. A display server issue is preventing Electron from initializing');
      }

      // Check if it's a "file not found" error
      if (launchError.message?.includes('ENOENT') || launchError.message?.includes('not found')) {
        console.log('[electronHarness] 🔍 This appears to be a FILE NOT FOUND error');
        console.log('[electronHarness] - Binary path may be incorrect or file may not exist');
        console.log('[electronHarness] - Check the executablePath being used');
      }

      // Check for permission issues
      if (launchError.message?.includes('EACCES') || launchError.message?.includes('permission')) {
        console.log('[electronHarness] 🔒 This appears to be a PERMISSION error');
        console.log('[electronHarness] - Binary may not be executable');
        console.log('[electronHarness] - chmod +x may be needed on the binary');
      }

      // Check for display server issues
      if (launchError.message?.includes('DISPLAY') ||
          launchError.message?.includes('cannot open display') ||
          launchError.message?.includes('xvfb')) {
        console.log('[electronHarness] 🖥️ This appears to be a DISPLAY SERVER error');
        console.log('[electronHarness] - Check if Xvfb is running properly');
        console.log('[electronHarness] - Verify DISPLAY environment variable is set correctly');
      }

      // Look for Electron's own logs
      try {
        const { execSync } = require('child_process');
        console.log('[electronHarness] Checking for recent Electron logs:');
        let electronLogs;
        try {
          electronLogs = execSync('find /tmp -name "electron_*" -type f -mmin -5 | xargs cat 2>/dev/null || echo "No recent logs found"',
                                  { timeout: 2000 }).toString();
          console.log('[electronHarness] Electron logs:', electronLogs || 'None found');
        } catch (logErr) {
          console.log('[electronHarness] Error getting Electron logs:', logErr.message);
        }
      } catch (e) {
        console.error('[electronHarness] Error during enhanced diagnostics:', e);
      }

      // Re-throw the original error
      throw launchError;
    }
  } catch (outerError) {
    console.error('[electronHarness] ❌ OUTER ERROR DURING LAUNCH OR DIAGNOSTICS:', outerError);

    // STEP 3: Remove all emergency recovery code that uses _electron.executablePath()
    // which doesn't exist in Playwright 1.52
    if (process.env.PLAYWRIGHT_IN_DOCKER === '1' && outerError.message?.includes('Process failed to launch')) {
      console.log('[electronHarness] ⚠️ Process failed to launch but recovery code removed to avoid executablePath issue');
    }

    // If we reached here, all attempts failed
    throw outerError;
  }
}
