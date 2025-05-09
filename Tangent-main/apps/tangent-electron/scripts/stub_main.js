// --------------------------------------------------------------
// Early diagnostics – prove which stub gets executed inside the
// Docker container and whether Electron's stderr is forwarded to
// Playwright.  This executes *before* any other require() so we
// cannot miss the log even if the process exits very quickly.
// --------------------------------------------------------------

console.log('[MAIN] stub_main.js loaded and running');

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let win;
let activeChild = null;

// Enable diagnostics in Docker environment
const DEBUG = process.env.MOCK_CODEX_DEBUG === '1' || process.env.PLAYWRIGHT_IN_DOCKER === '1';
const isDocker = process.env.PLAYWRIGHT_IN_DOCKER === '1';

// Debug file for main process diagnostic messages
const LOG_FILE = isDocker ? '/tmp/main-process-debug.log' : '';
if (LOG_FILE) {
  fs.writeFileSync(LOG_FILE, `Main Process Debug Log - ${new Date().toISOString()}\n`, { flag: 'w' });
  fs.appendFileSync(LOG_FILE, `Process ID: ${process.pid}\n`);
  fs.appendFileSync(LOG_FILE, `Working directory: ${process.cwd()}\n`);
  fs.appendFileSync(LOG_FILE, `ELECTRON_RUN_AS_NODE: ${process.env.ELECTRON_RUN_AS_NODE}\n`);
  fs.appendFileSync(LOG_FILE, `MOCK_CODEX_PATH: ${process.env.MOCK_CODEX_PATH}\n`);
  fs.appendFileSync(LOG_FILE, `MOCK_CODEX_ARGS: ${process.env.MOCK_CODEX_ARGS}\n`);
  fs.appendFileSync(LOG_FILE, `MOCK_CODEX_DEBUG: ${process.env.MOCK_CODEX_DEBUG}\n`);
  fs.appendFileSync(LOG_FILE, `PLAYWRIGHT_IN_DOCKER: ${process.env.PLAYWRIGHT_IN_DOCKER}\n\n`);
}

function debugLog(...args) {
  console.log('[MAIN]', ...args);
  if (LOG_FILE) {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  }
}

function errorLog(...args) {
  console.error('[MAIN]', ...args);
  if (LOG_FILE) {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ERROR: ${args.join(' ')}\n`);
  }
}

// Add IPC drain barrier for Playwright to wait until all children close
ipcMain.handle('codex:await-drain', async () => {
  debugLog('[codex] await-drain called, waiting for children to close');
  // Wait for every tracked child to emit 'close'
  await Promise.all(
    [...(global.__codexChildObjects || [])].map(
      cp => new Promise(res => {
        if (!cp) return res();
        if (cp.killed) return res();
        cp.once('close', () => {
          debugLog('[codex] child closed in await-drain');
          res();
        });
        // Safety timeout in case close never fires
        setTimeout(() => {
          debugLog('[codex] await-drain timeout for child');
          res();
        }, 5000);
      })
    )
  );
  debugLog('[codex] await-drain complete');
});
        
// keep references to every child we ever spawned so we can clean them up
global.__codexChildObjects ??= new Set();

// Utility to safely clean up a child process
function cleanupChild(cp) {
  if (!cp) return;
  
  debugLog(`Cleaning up child process ${cp.pid}`);
  
  try { cp.stdout?.removeAllListeners();  cp.stdout?.destroy(); cp.stdout?.unref?.(); } catch {}
  try {
    if (cp.stdin && !cp.stdin.destroyed) {
      cp.stdin.end?.();
    }
    cp.stdin?.destroy();
    cp.stdin?.unref?.();
  } catch {}
  try { cp.unref?.(); } catch {}
  
  debugLog(`Child process ${cp.pid} cleanup complete`);
}
        
// Set Electron's CWD up-front, before anything else in the file can try to resolve paths
try { 
  process.chdir(__dirname); 
  debugLog(`Changed working directory to ${__dirname}`);
}
catch (e) { 
  errorLog(`chdir failed: ${e.message}`); 
}

function spawnMock(codexPath, argStr = '') {
  debugLog('Spawning mock Codex from path:', codexPath);
  
  // Process arguments
  const argsArray = argStr.split(' ').filter(Boolean);
  
  // Set the working directory to be the directory containing the mock script
  // This ensures relative paths in the script will work correctly
  const workingDir = path.dirname(codexPath);
  
  // Log comprehensive debug info
  debugLog('Spawn details:');
  debugLog(`- Mock script path: ${codexPath}`);
  debugLog(`- Working directory: ${workingDir}`);
  debugLog(`- Current execPath: ${process.execPath}`);
  debugLog(`- Arguments: ${JSON.stringify(argsArray)}`);
  
  // Choose the appropriate Node executable based on environment
  // In Docker, use 'node' command (available on PATH)
  // Otherwise, use process.execPath with ELECTRON_RUN_AS_NODE=1
  const nodeExecutable = isDocker ? 'node' : process.execPath;
  
  debugLog(`Using Node executable: ${nodeExecutable}`);
  debugLog(`Full command: ${nodeExecutable} ${codexPath} ${argsArray.join(' ')}`);
  
  // -----------------------------------------------------------------------
  // CRITICAL FIX: Use -- delimiter to prevent Electron from inserting its 
  // bundle path between the executable and the script
  // -----------------------------------------------------------------------
  const finalArgs = nodeExecutable === process.execPath ? 
      ['--', codexPath, ...argsArray] : 
      [codexPath, ...argsArray];
  
  debugLog(`Final args array: ${JSON.stringify(finalArgs)}`);
  debugLog(`PATH environment: ${process.env.PATH}`);

  // ---------------------------------------------------------------
  // Spawn the mock Codex child with improved stdio handling
  // ---------------------------------------------------------------
  const child = spawn(nodeExecutable, finalArgs, {
    stdio: ['pipe', 'pipe', 'pipe'], // pipe all stdio for full visibility
    cwd: workingDir,
    detached: true, // allow OS to own the child after it is spawned
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      MOCK_CODEX_DEBUG: DEBUG ? '1' : '0',
      // Add ELECTRON_RUN_AS_NODE only when using Electron binary
      ...(nodeExecutable === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {})
    }
  });
  
  // Register for tracking and cleanup
  global.__codexChildObjects.add(child);
  debugLog(`Child spawned with PID: ${child.pid}`);

  // Detach stdio handles to avoid keeping event loop alive
  if (typeof child.unref === 'function') {
    child.unref();
    debugLog('Child process unreferenced from event loop');
  }
  
  // Don't unref the stdio handles yet - we need them to capture output
  
  // Capture startup errors
  child.on('error', e => {
    errorLog(`spawn error: ${e.message}`);
    win.webContents.send('codex:error', { message: e.message });
  });
  
  // Set up active child reference for send handler
  activeChild = child;

  // Register in global trackers
  global.__codexActivePids ??= new Set();
  global.__codexActivePids.add(child.pid);

  // Increment spawn counter for test verification
  global.__codexSpawnCount = (global.__codexSpawnCount || 0) + 1;
  debugLog(`Total Codex spawn count: ${global.__codexSpawnCount}`);

  // ---------------------------------------------------------------------
  // IMPROVED STDOUT HANDLING: Better line buffering and error resilience
  // ---------------------------------------------------------------------
  let firstChunk = true;
  let lineBuf = '';
  
  // Capture stderr for diagnostic purposes
  child.stderr.on('data', data => {
    const str = data.toString().trim();
    if (str) {
      debugLog(`Child stderr: ${str}`);
    }
  });

  // CRITICAL - improved stdout handling
  child.stdout.on('data', chunk => {
    const chunkStr = chunk.toString();
    debugLog(`Received stdout chunk (${chunkStr.length} bytes)`);
    
    // EMERGENCY FIX: Directly try to parse if it looks like a complete JSON object
    if (chunkStr.trim().startsWith('{') && chunkStr.trim().endsWith('}')) {
      try {
        const directObj = JSON.parse(chunkStr.trim());
        debugLog(`Direct JSON parse successful: ${JSON.stringify(directObj).substring(0, 100)}`);
        
        // First message triggers running:true status
        if (firstChunk) {
          firstChunk = false;
          win.webContents.send('codex:status', { running: true });
          debugLog('Sent initial running:true status');
        }
        
        // Immediately forward message
        win.webContents.send('codex:message', directObj);
        debugLog('Forwarded direct JSON message to renderer');
        
        // Continue with line buffer processing to handle any remaining content
      } catch(e) {
        // Not complete JSON, continue with normal buffer processing
        debugLog(`Direct JSON parse failed: ${e.message}`);
      }
    }
    
    // Append to line buffer and process complete lines
    lineBuf += chunkStr;
    let idx;
    
    while ((idx = lineBuf.indexOf('\n')) !== -1) {
      const ln = lineBuf.slice(0, idx);
      lineBuf = lineBuf.slice(idx + 1);
      
      if (!ln.trim()) continue;
      
      // Handle non-JSON lines (like oversize content)
      if (!ln.trim().startsWith('{')) {
        debugLog(`Non-JSON line: ${ln.substring(0, 50)}...`);
        
        const MAX = 1_000_000;
        if (ln.length > MAX) {
          const preview = ln.slice(0, 300) + '…';
          win.webContents.send('codex:error', {
            message: `Received oversize line (${ln.length} bytes): ${preview}`
          });
          debugLog('Sent oversize error to renderer');
        }
        continue;
      }
      
      // Parse and forward JSON lines
      try {
        const obj = JSON.parse(ln);
        debugLog(`Parsed JSON object: ${JSON.stringify(obj).substring(0, 100)}`);
        
        // First JSON signals running:true
        if (firstChunk) {
          firstChunk = false;
          win.webContents.send('codex:status', { running: true });
          debugLog('Sent initial running:true status');
        }
        
        // Forward message to renderer
        win.webContents.send('codex:message', obj);
        debugLog('Forwarded JSON message to renderer');
      } catch (e) {
        errorLog(`JSON parse error: ${e.message} for line: ${ln.substring(0, 50)}...`);
      }
    }
  });
  
  // Handle process exit
  child.on('exit', (code, signal) => {
    debugLog(`Child process exited with code ${code}, signal ${signal}`);
    win.webContents.send('codex:status', { running: false });
    win.webContents.send('codex:exit', { code, signal });
    
    // Perform thorough cleanup
    cleanupChild(child);

    // Extra safety measures
    try {
      child.stdout?.destroy?.();
      child.stdout?.unref?.();
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end?.();
      }
      child.stdin?.destroy?.();
      child.stdin?.unref?.();
      child.unref?.();
    } catch (e) {
      errorLog(`Cleanup error: ${e.message}`);
    }

    // Remove from global trackers
    global.__codexChildObjects.delete(child);
    global.__codexActivePids.delete(child.pid);
    
    activeChild = null;
    debugLog('Child process cleanup complete');
  });

  // Handle stdio streams closure
  child.once('close', () => {
    debugLog('Child process close event fired (all stdio streams closed)');
    
    // Thorough cleanup of stdio resources
    try {
      child.stdout?.destroy?.();
      child.stdout?.unref?.();
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end?.();
      }
      child.stdin?.destroy?.();
      child.stdin?.unref?.();

      // Force-close file descriptors
      try {
        if (typeof child.stdout?.fd === 'number') {
          try { fs.closeSync(child.stdout.fd); } catch {}
        }
        if (typeof child.stdin?.fd === 'number') {
          try { fs.closeSync(child.stdin.fd); } catch {}
        }
      } catch (e) {
        errorLog(`File descriptor cleanup error: ${e.message}`);
      }

      child.unref?.();
    } catch (e) {
      errorLog(`Close event cleanup error: ${e.message}`);
    }
    
    debugLog('Child process close handler complete');
  });

  // Set up process termination handlers
  const killChild = () => {
    if (child && !child.killed) {
      try { 
        debugLog(`Force killing child ${child.pid}`);
        child.kill('SIGKILL'); 
      } catch (e) {
        errorLog(`Kill error: ${e.message}`);
      }
    }
  };

  // --------------------------------------------------------------------
  // CRITICAL FIX: Improved shutdown handling with clear log messages
  // --------------------------------------------------------------------
  
  // Helper to dispose of all child processes during shutdown
  const disposeAllChildren = async () => {
    debugLog('Disposing all child processes');
    const wait = [];
    
    for (const cp of Array.from(global.__codexChildObjects)) {
      try { 
        debugLog(`Killing child ${cp.pid}`);
        cp.kill('SIGKILL'); 
      } catch (e) {
        errorLog(`Kill error during disposal: ${e.message}`);
      }
      
      wait.push(new Promise((res) => {
        const timeout = setTimeout(() => {
          debugLog(`Timeout waiting for child ${cp.pid} to exit`);
          res();
        }, 2000);
        
        cp.once('exit', () => {
          clearTimeout(timeout);
          debugLog(`Child ${cp.pid} exited during disposal`);
          res();
        });
      }));
      
      cleanupChild(cp);
    }
    
    global.__codexChildObjects.clear();
    global.__codexActivePids?.clear();
    activeChild = null;

    debugLog('Waiting for all child processes to exit');
    await Promise.all(wait);
    debugLog('All child processes disposed');
  };

  // Block quit until all children are closed
  app.on('before-quit', (e) => {
    if (!global.__codexChildObjects?.size) {
      debugLog('No child processes to clean up during before-quit');
      return;
    }
    
    debugLog(`Preventing quit, ${global.__codexChildObjects.size} children to clean up`);
    e.preventDefault();
    
    disposeAllChildren().catch((e) => {
      errorLog(`Child disposal error: ${e?.message || 'unknown error'}`);
    }).finally(() => {
      debugLog('Child disposal complete, application can quit now');
    });
  });

  // Fallback cleanup
  app.on('will-quit', () => {
    debugLog('will-quit event fired');
    try { 
      disposeAllChildren(); 
    } catch (e) {
      errorLog(`will-quit cleanup error: ${e.message}`);
    }
  });

  // Process termination handlers
  process.on('exit', () => {
    debugLog('process.exit event fired');
    killChild();
  });
  
  process.on('SIGTERM', () => {
    debugLog('SIGTERM received');
    killChild();
  });
  
  process.on('SIGINT', () => {
    debugLog('SIGINT received');
    killChild();
  });
  
  debugLog(`Mock process setup complete for PID ${child.pid}`);
  return child;
}

// Send handler for codex:send IPC messages
function sendHandler(_e, text) {
  if (activeChild && activeChild.stdin) {
    debugLog(`Sending to Codex stdin: ${text}`);
    activeChild.stdin.write(text + '\n');
    
    // Try to force flush
    try {
      if (typeof activeChild.stdin.flush === 'function') {
        activeChild.stdin.flush();
      }
    } catch (e) {
      // Ignore flush errors
    }
  } else {
    errorLog('Cannot send to Codex - no active child process');
  }
}

// Handler for explicit codex.start command
ipcMain.handle('codex:start', (_e, p, a) => {
  debugLog(`codex:start received - path: ${p}, args: ${a}`);
  
  // Prevent duplicate processes
  if (activeChild) {
    debugLog('codex:start ignored – child already active');
    return true;
  }
  
  // Validate path
  if (!p) {
    errorLog('ERROR: Received undefined or empty path');
    // Use a fallback path
    p = '/repo/scripts/mock_codex_headless.js';
    debugLog(`Using fallback path: ${p}`);
  }
  
  // Check file existence
  const exists = fs.existsSync(p);
  debugLog(`Path exists check: ${exists}`);
  
  if (!exists) {
    errorLog(`ERROR: Path does not exist: ${p}`);
    return false;
  }
  
  // Spawn process
  spawnMock(p, a);
  return true;
});

// Handle settings changes to toggle Codex integration
ipcMain.on('settings:patch', (_e, cfg) => {
  if (!cfg) {
    debugLog('Received empty settings patch');
    return;
  }

  debugLog(`settings:patch received: ${JSON.stringify(cfg)}`);
  const enabled = !!cfg.enableCodexIntegration;

  if (enabled) {
    // Get path from environment or use fallback
    const codexPath = process.env.MOCK_CODEX_PATH || '/repo/scripts/mock_codex_headless.js';
    const codexArgs = process.env.MOCK_CODEX_ARGS || '';

    debugLog(`Enabling Codex integration with path: ${codexPath}, args: ${codexArgs}`);
    spawnMock(codexPath, codexArgs);
    
    // Register message handler
    ipcMain.on('codex:send', sendHandler);
    debugLog('codex:send handler registered');
  } else if (activeChild) {
    debugLog('Disabling Codex integration');
    
    if (activeChild && !activeChild.killed) {
      try { 
        debugLog(`Sending SIGTERM to child ${activeChild.pid}`);
        activeChild.kill('SIGTERM'); 
      } catch (e) {
        errorLog(`Kill error: ${e.message}`);
      }
      
      cleanupChild(activeChild);
      global.__codexChildObjects.delete(activeChild);
      
      // Set up fallback SIGKILL timer
      const pid = activeChild.pid;
      const timer = setTimeout(() => {
        try { 
          debugLog(`Fallback SIGKILL for PID ${pid}`);
          process.kill(pid, 0); 
          activeChild.kill('SIGKILL'); 
        } catch (e) {
          // Process may already be gone - ignore errors
        }
      }, 1500);
      
      if (timer.unref) timer.unref();
    }
    
    activeChild = null;
    
    // Unregister message handler
    ipcMain.removeListener('codex:send', sendHandler);
    debugLog('codex:send handler removed');
  }
});

// Install a console relay to ensure logs are visible to Playwright
app.on('ready', () => {
  debugLog('App ready event fired');
  
  const originalLog = console.log;
  console.log = (...a) => { 
    process.stdout.write('[MAIN] ' + a.join(' ') + '\n');
    originalLog(...a); 
  };
});

// Create the application window when Electron is ready
app.whenReady().then(() => {
  debugLog('Creating browser window');
  
  win = new BrowserWindow({
    show: true, // Required for Playwright visibility
    width: 800,
    height: 600,
    backgroundThrottling: false,
    webPreferences: { 
      preload: path.resolve(__dirname, 'preload.js'), 
      contextIsolation: true 
    }
  });
  
  // Log renderer path information
  const rendererPath = path.resolve(__dirname, 'renderer.html');
  debugLog(`Current working directory: ${process.cwd()}`);
  debugLog(`__dirname: ${__dirname}`);
  debugLog(`Renderer path: ${rendererPath}`);
  debugLog(`Renderer file exists: ${fs.existsSync(rendererPath)}`);
  
  // Load the renderer HTML
  win.loadFile(rendererPath);
  
  // Monitor page loading
  win.webContents.on('did-finish-load', () => {
    debugLog('Renderer page loaded successfully');
    
    // Check WorkspaceView element
    win.webContents.executeJavaScript(`
      const hasWorkspaceView = !!document.querySelector('main.WorkspaceView');
      const isVisible = hasWorkspaceView && 
        window.getComputedStyle(document.querySelector('main.WorkspaceView')).display !== 'none';
      ({ hasWorkspaceView, isVisible });
    `).then(result => {
      debugLog(`DOM check: ${JSON.stringify(result)}`);
    }).catch(err => {
      errorLog(`DOM check failed: ${err.message}`);
    });
  });
  
  // Monitor page load errors
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    errorLog(`Failed to load renderer: ${errorCode} - ${errorDescription}`);
  });
  
  // Additional page load monitors
  win.webContents.on('dom-ready', () => {
    debugLog('DOM is ready');
  });
  
  win.webContents.on('did-create-window', () => {
    debugLog('Window created');
  });
  
  debugLog('Window setup complete');
});

// Prevent app from exiting when all windows are closed
app.on('window-all-closed', () => {
  debugLog('window-all-closed event fired, preventing app exit');
});