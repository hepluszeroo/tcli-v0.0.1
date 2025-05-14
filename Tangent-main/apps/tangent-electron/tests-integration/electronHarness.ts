import { _electron, ElectronApplication } from '@playwright/test'
import path from 'path'
import fs from 'fs'

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
    '--enable-logging=stderr',
    '--remote-debugging-port=9223'  // Use a fixed port instead of 0
  ];
  
  // Special environment variables for Electron
  const electronEnv: NodeJS.ProcessEnv = {
    ...env,
    ELECTRON_ENABLE_LOGGING: '1',
    // IMPORTANT: Disable sandbox but DON'T set ELECTRON_RUN_AS_NODE
    ELECTRON_DISABLE_SANDBOX: '1',
    ELECTRON_LOG_FILE: '/tmp/electron-debug.log',
    // Enable all debugging for Electron and Node inspector
    ELECTRON_ENABLE_STACK_DUMPING: '1',
    ELECTRON_EXTRA_LAUNCH_ARGS: '--trace-warnings',
    DEBUG: 'electron*,pw*' // Enable extensive debugging 
  }
  
  // Make sure MOCK_CODEX_PATH is available to the Electron process
  if (process.env.MOCK_CODEX_PATH) {
    console.log('[electronHarness] Forwarding MOCK_CODEX_PATH:', process.env.MOCK_CODEX_PATH);
    electronEnv.MOCK_CODEX_PATH = process.env.MOCK_CODEX_PATH;
  }
  
  if (process.env.MOCK_CODEX_ARGS) {
    console.log('[electronHarness] Forwarding MOCK_CODEX_ARGS:', process.env.MOCK_CODEX_ARGS);
    electronEnv.MOCK_CODEX_ARGS = process.env.MOCK_CODEX_ARGS;
  }
  
  // Additional Docker environment variables
  if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
    console.log('[electronHarness] Running in Docker container');

    // (PathHelpers now centralize MOCK_CODEX_PATH; no manual override needed here)

    Object.assign(electronEnv, {
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      ELECTRON_ENABLE_STACK_DUMPING: '1',
      DEBUG: '1' // Enable debug logging
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
  // Playwright needs a remote-debugging-port to capture the websocket.
  // We now use a fixed port (9223) instead of 0 for better stability. 
  // Keep --no-sandbox / --disable-gpu for container stability.
  // -------------------------------------------------------------------
  const finalArgs = [
    ...commonFlags,  // Common flags already include the remote debugging port
    '--trace-warnings',  // Add additional debugging flags
    path.join(actualBuildDir, 'bundle', 'main.js'),
    ...(workspace ? [workspace] : [])
  ]
  
  // Note: The main.js loaded here is now using the real preload.js bundle
  // which provides window.api.* interfaces needed by the Codex integration tests
  
  console.log('[electronHarness] Launching Electron with args:', finalArgs)
  console.log('[electronHarness] CWD:', actualBuildDir)

  try {
    // Copy Electron binary to /tmp/electron-dist/ if in Docker
    // This ensures proper sandbox permissions and execution rights
    if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
      console.log('[electronHarness] Running in Docker - ensuring electron binary in /tmp/electron-dist');
      const tmpElectronPath = '/tmp/electron-dist/electron';
      
      if (!fsExists(tmpElectronPath)) {
        const vendorElectronPath = '/repo/vendor/electron/dist/electron';
        if (fsExists(vendorElectronPath)) {
          console.log(`[electronHarness] Copying vendor electron binary from ${vendorElectronPath} to ${tmpElectronPath}`);
          // Create directory if it doesn't exist
          fs.mkdirSync('/tmp/electron-dist', { recursive: true });
          // Copy the binary
          fs.copyFileSync(vendorElectronPath, tmpElectronPath);
          // Make it executable
          fs.chmodSync(tmpElectronPath, 0o755);
          
          // Set the executablePath to this binary
          opts.electronBinary = tmpElectronPath;
        } else {
          console.log('[electronHarness] WARNING: Vendor Electron binary not found');
        }
      } else {
        console.log(`[electronHarness] Using existing electron binary at ${tmpElectronPath}`);
        opts.electronBinary = tmpElectronPath;
      }
    }
    
    console.log('[electronHarness] Launching Electron with:');
    console.log(`  - executablePath: ${opts.electronBinary}`);
    console.log(`  - cwd: ${actualBuildDir}`);
    console.log(`  - args: ${finalArgs.join(' ')}`);
    
    // Add additional options for improved Electron launch debug info
    const app = await _electron.launch({
      executablePath: opts.electronBinary,
      // Use the real build directory as working directory; passing a non-
      // existent cwd causes Electron to abort before any user code runs.
      cwd: actualBuildDir,
      args: finalArgs,
      env: electronEnv,
      // Critical: enable stdio output capture
      timeout: opts.timeout || 90000, // Use explicit timeout
      dumpio: true, // Critical for allowing synthetic banners to be captured
    });
    
    console.log('[electronHarness] Electron launched successfully');
    
    // Return the app interface (no child process handle needed)
    return { app };
    
  } catch (error) {
    console.error('Failed to launch Electron:', error);
    // Enhanced error details
    if (error instanceof Error) {
      console.error(`Error name: ${error.name}`);
      console.error(`Error message: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
      
      // Specific debugging for timeout errors
      if (error.message.includes('timeout') || error.message.includes('Process failed to launch')) {
        console.error('[electronHarness] TROUBLESHOOTING: This appears to be a timeout/launch error.');
        console.error('[electronHarness] This is likely due to Playwright not detecting the DevTools banner.');
        console.error('[electronHarness] Check if synthetic banners are being emitted correctly in e2e_stub/main.ts');
      }
    }
    throw error;
  }
}
