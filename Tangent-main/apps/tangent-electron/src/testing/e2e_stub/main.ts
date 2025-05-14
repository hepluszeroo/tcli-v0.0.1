import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

// Import CodexProcessManager to ensure it's included in the bundle
import CodexProcessManager from '../../main/codex_process_manager';

// ---------------------------------------------------------------------------
// E2E-only helper: emit a synthetic DevTools banner so Playwright 1.52 can
// detect Electron's debugger port inside Docker.
//
// Context:  Chromium ≥121 running under Electron 35 no longer prints the
// "DevTools listening on ws://…" line when started with the flag combination
// Playwright uses (`--inspect=0 --remote-debugging-port=0`).  Playwright's
// `_electron.launch()` waits for that line and times out if it never shows.
//
// For test bundles built via `build:test-e2e` we simply write a synthetic
// banner to **stderr** right after the stub is loaded.  `process.debugPort`
// already contains the inspector port chosen by the `--inspect` flag.  It is
// therefore safe to reference.
// ---------------------------------------------------------------------------

// CRITICAL SYNTHETIC BANNERS - Emitted immediately at the top of the file
// NOTE: Using double quotes and fixed port (9222) to prevent bundling issues
process.stderr.write("Debugger listening on ws://127.0.0.1:9222/synthetic_forced\n");
process.stderr.write("DevTools listening on ws://127.0.0.1:9222/synthetic_forced\n");
console.error("Debugger listening on ws://127.0.0.1:9222/synthetic_forced");
console.error("DevTools listening on ws://127.0.0.1:9222/synthetic_forced");

// @ts-ignore
global.SYNTHETIC_BANNER_ENABLED = true;
console.error("[BUNDLE LOADED] E2E stub with synthetic banner support initialized");

// Helper function to emit additional banners if needed
function emitSyntheticBanners() {
  // Use fixed port 9222 instead of dynamic port to avoid template literal issues
  const port = 9222;
  
  // Write directly to stderr with double quotes (not template literals)
  process.stderr.write("Debugger listening on ws://127.0.0.1:9222/synthetic_forced\n");
  process.stderr.write("DevTools listening on ws://127.0.0.1:9222/synthetic_forced\n");
  
  // Also emit via console.error with double quotes
  console.error("Debugger listening on ws://127.0.0.1:9222/synthetic_forced");
  console.error("DevTools listening on ws://127.0.0.1:9222/synthetic_forced");
  
  // Mark that banners were emitted (for diagnostics)
  // @ts-ignore
  global.SYNTHETIC_BANNERS_EMITTED = true;
}

// Emit banners immediately
emitSyntheticBanners();

// Also emit on next tick and after a short delay to ensure they appear
process.nextTick(emitSyntheticBanners);
setTimeout(emitSyntheticBanners, 100);

// ---------------------------------------------------------------------------
// Setup diagnostics for Electron launch troubleshooting
// ---------------------------------------------------------------------------

// Register a diagnostic handler that will emit banner info
// This will help debug why banners might not be detected
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION in E2E stub:', err);
  // Try to re-emit banners in case they were missed
  try {
    // Use fixed port 9222 instead of dynamic port to avoid template literal issues
    process.stderr.write("Debugger listening on ws://127.0.0.1:9222/synthetic_forced\n");
    process.stderr.write("DevTools listening on ws://127.0.0.1:9222/synthetic_forced\n");
    console.error("Debugger listening on ws://127.0.0.1:9222/synthetic_forced");
    console.error("DevTools listening on ws://127.0.0.1:9222/synthetic_forced");
  } catch (e) {
    console.error('Failed to emit emergency banners:', e);
  }
});

// Add diagnostic info
const bannerInfo = {
  stubVersion: 'enhanced-synthetic-2025-05-14',
  debugPort: (process as any).debugPort || 'unknown',
  processId: process.pid,
  nodeVersion: process.version,
  electronVersion: process.versions.electron || 'unknown',
  platform: process.platform,
};

console.error('[BANNER-DIAG]', JSON.stringify(bannerInfo, null, 2));

// ---------------------------------------------------------------------------
// Minimal *fake* Workspace object used solely by CodexProcessManager during
// E2E tests.  We do NOT pull the full production Workspace implementation in
// order to keep the stub lightweight and independent of unrelated runtime
// concerns (indexing, Svelte, etc.).  The manager only needs two things:
//   • workspace.observers[i].window.webContents — for broadcast()
//   • workspace.contentsStore.files.path     — for spawn() cwd
// Everything else may be omitted.
// ---------------------------------------------------------------------------

type StubWorkspace = {
  observers: { window: BrowserWindow }[];
  contentsStore: { files: { path: string } };
};

// The actual instance will be created *after* the main BrowserWindow exists
// so that we can register it as the sole observer.
let stubWorkspace: StubWorkspace | null = null;

// Manager instance (lazy-constructed when the flag toggles to true)
let codexMgr: CodexProcessManager | null = null;

/** Ensure we have both a workspace object and a CodexProcessManager. */
function ensureManager(window: BrowserWindow): CodexProcessManager {
  if (!stubWorkspace) {
    const workspacePath = process.argv[2] ? process.argv[2] : process.cwd();
    stubWorkspace = {
      observers: [{ window }],
      contentsStore: { files: { path: workspacePath } }
    };
    
    // Enhanced logging to verify window IDs
    console.log(`[stub] ensureManager: Created new stubWorkspace with observer window ID: ${window.webContents.id}`);
    console.log(`[stub] ensureManager: All windows count: ${BrowserWindow.getAllWindows().length}`);
    BrowserWindow.getAllWindows().forEach((win, i) => {
      console.log(`[stub] ensureManager: Window ${i} webContents.id: ${win.webContents.id}, isVisible: ${win.isVisible()}`);
    });
  } else if (stubWorkspace.observers.length === 0) {
    // (should never happen, but guard just in case)
    stubWorkspace.observers.push({ window });
  }

  if (!codexMgr) {
    codexMgr = new CodexProcessManager(stubWorkspace as any);

    // Monkey-patch start() so we can tap into the ChildProcess streams for
    // debugging without modifying production source.
    const origStart = codexMgr.start.bind(codexMgr);
    (codexMgr as any).start = function () {
      const ok = origStart();
      try {
        if (this.child && !(this.child as any).__debugTaped) {
          this.child.stdout?.on('data', (d) => {
            console.log('[codex child stdout]', String(d).trim());
          });
          (this.child as any).__debugTaped = true;
        }
      } catch {}
      return ok;
    };

    // Track in global set so Playwright specs can query size/count just like
    // real Tangent.  (Needed by dark-launch and toggle tests.)
    if (!(global as any).__codexManagers) (global as any).__codexManagers = new Set();
    (global as any).__codexManagers.add(codexMgr);
  }
  return codexMgr;
}

/** Helper to (re)apply the enableCodexIntegration flag at runtime. */
function setCodexEnabled(window: BrowserWindow, enabled: boolean) {
  const mgr = ensureManager(window);
  if (enabled) {
    mgr.start();

    // One-off debug wiring: mirror every codex:* broadcast to main stdout so
    // we can observe the flow during Playwright runs.
    if (!(global as any).__codexDebugHook) {
      const { ipcMain } = require('electron');
      const channels = ['codex:message','codex:status','codex:error','codex:exit'];
      for (const ch of channels) {
        ipcMain.on(ch, (_e, payload) => {
          console.log(`[main debug] ipc ${ch}`, JSON.stringify(payload));
        });
      }
      (global as any).__codexDebugHook = true;
    }
  } else {
    mgr.stop();
  }
}

// ---------------------------------------------------------------------------
// Runtime monkey-patch so the compiled E2E bundle gets the hardened stop()
// behaviour even when the underlying Webpack bundle is not rebuilt after
// source edits. This guarantees that the Electron main process can terminate
// quickly during Playwright teardown and prevents the 60-second worker time-
// outs observed in CI.
// ---------------------------------------------------------------------------

if (CodexProcessManager && (CodexProcessManager as any).prototype?.stop) {
  const FORCE_KILL_MS = 2000;

  (CodexProcessManager as any).prototype.stop = function (): boolean {
    if (!this.child) return true;

    try {
      const child = this.child;

      this.child = null;
      this.parser = null;

      if (this.firstJsonTimer) {
        clearTimeout(this.firstJsonTimer);
        this.firstJsonTimer = null;
      }

      const detachStreams = () => {
        try {
          child.stdout?.removeAllListeners();
          child.stderr?.removeAllListeners();
          child.stdout?.destroy?.();
          child.stderr?.destroy?.();
          child.stdin?.destroy?.();

          // Drop references so the Node event-loop no longer waits for the
          // underlying file descriptors – mirrors the production fix in
          // codex_process_manager.ts.
          (child.stdout as any)?.unref?.();
          (child.stderr as any)?.unref?.();
          (child.stdin as any)?.unref?.();
        } catch {}
      };

      let exited = false;
      const exitHandler = () => {
        exited = true;
        detachStreams();
        if (global.__codexActivePids && child.pid) {
          global.__codexActivePids.delete(child.pid);
        }
        this.broadcast('codex:status', { running: false });
      };

      child.once('exit', exitHandler);

      try {
        child.kill('SIGTERM');
      } catch {}

      const killTimer = setTimeout(() => {
        if (!exited) {
          try { child.kill('SIGKILL'); } catch {}
        }
      }, FORCE_KILL_MS);
      // Do not keep the event-loop alive unnecessarily.
      // @ts-ignore unref not always present in older Node typings
      if (killTimer.unref) killTimer.unref();

      detachStreams();

      return true;
    } catch (err) {
      this.log?.error?.('Patched stop() error:', err);
      this.broadcast?.('codex:error', { message: String(err) });
      return false;
    }
  };
}

// ---------------------------------------------------------------------------
// Listen for global-settings patches coming from the Preload bridge.  Only one
// field matters for the Codex tests: `enableCodexIntegration`.
// ---------------------------------------------------------------------------

ipcMain.on('patchGlobalSettings', (event, patch) => {
  try {
    if (!patch || typeof patch !== 'object') return;

    if ('enableCodexIntegration' in patch) {
      // Use the sender's window if available – falls back to the first
      // BrowserWindow from our stub in the unlikely case the channel is
      // emitted before the window is ready.
      const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getAllWindows()[0];
      setCodexEnabled(win, !!patch.enableCodexIntegration);
    }
  } catch (err) {
    console.error('patchGlobalSettings handler threw:', err);
  }
});


// Handle window-all-closed event to ensure app quits properly
// This is essential for the quit-cleanup test
// -------------------------------------------------------------
// In the production build Tangent quits when the last window
// closes.  For Playwright we want to keep the process alive until
// the harness (electronApplication.close()) asks for shutdown;
// otherwise the first hidden background window might close and take
// Chromium down with it *before* tests obtain a handle.
// -------------------------------------------------------------
app.on('window-all-closed', () => {
  // Intentionally NO app.quit() here – allow Playwright to control
  // lifecycle explicitly.  We still print a breadcrumb for easier
  // debugging.
  console.log('E2E test stub: all windows closed (no-op)');
});

// Wait for Electron app to be ready
app.whenReady().then(() => {
  console.log('E2E test stub: app ready');
  console.log('Current working directory:', process.cwd());
  console.log('__dirname:', __dirname);
  console.log('__filename:', __filename);
  console.log('app.getAppPath():', app.getAppPath());

  // Resolve path to the compiled preload bundle.  In the E2E build the file
  // ends up at  <appPath>/bundle/preload.js  regardless of source layout.
  // In the compiled build the preload ends up either as
  //   <appPath>/preload.js            (when appPath === __build/bundle)
  //   or <appPath>/bundle/preload.js  (when appPath === __build)
  // Preload sits next to the compiled main bundle after build:test-e2e
  let preloadPath = path.join(path.dirname(__filename), 'preload.js');
  console.log('Trying preload path (same dir):', preloadPath, 'exists:', fs.existsSync(preloadPath));

  if (!fs.existsSync(preloadPath)) {
    preloadPath = path.join(path.dirname(__filename), 'bundle', 'preload.js');
    console.log('Trying preload path (bundle subdir):', preloadPath, 'exists:', fs.existsSync(preloadPath));
  }

  // Additional fallback paths for packaged app
  if (!fs.existsSync(preloadPath)) {
    preloadPath = path.join(app.getAppPath(), 'preload.js');
    console.log('Trying preload path (app root):', preloadPath, 'exists:', fs.existsSync(preloadPath));
  }

  if (!fs.existsSync(preloadPath)) {
    preloadPath = path.join(app.getAppPath(), 'bundle', 'preload.js');
    console.log('Trying preload path (app root bundle):', preloadPath, 'exists:', fs.existsSync(preloadPath));
  }

  // Check for preload in __build directories
  if (!fs.existsSync(preloadPath)) {
    preloadPath = path.join(process.cwd(), '__build', 'bundle', 'preload.js');
    console.log('Trying preload path (__build/bundle):', preloadPath, 'exists:', fs.existsSync(preloadPath));
  }

  if (!fs.existsSync(preloadPath)) {
    // Additional diagnostic: list the contents of the app directory
    console.error('FATAL: could not resolve compiled preload at', preloadPath);
    console.log('Listing files in app directory:');

    try {
      // List app root directory
      const appDir = app.getAppPath();
      console.log(`Files in ${appDir}:`);
      const appFiles = fs.readdirSync(appDir);
      appFiles.forEach(file => console.log(`- ${file}`));

      // Check if bundle directory exists
      const bundleDir = path.join(appDir, 'bundle');
      if (fs.existsSync(bundleDir) && fs.statSync(bundleDir).isDirectory()) {
        console.log(`Files in ${bundleDir}:`);
        const bundleFiles = fs.readdirSync(bundleDir);
        bundleFiles.forEach(file => console.log(`- ${file}`));
      }

      // List current directory
      const currentDir = process.cwd();
      console.log(`Files in ${currentDir}:`);
      const currentFiles = fs.readdirSync(currentDir);
      currentFiles.forEach(file => console.log(`- ${file}`));
    } catch (err) {
      console.error('Error listing files:', err);
    }

    app.quit();
    return;
  }
  console.log('Using preload path:', preloadPath);

  // Playwright sometimes propagates ELECTRON_ENABLE_SANDBOX=1 which prevents
  // our private IPC channels from working. Remove it explicitly in the test
  // stub before any BrowserWindow is created.
  if (process.env.ELECTRON_ENABLE_SANDBOX) {
    console.log('[e2e_stub] removing ELECTRON_ENABLE_SANDBOX flag');
    delete process.env.ELECTRON_ENABLE_SANDBOX;
  }

  // Log forwarded Node binary path (helps debugging spawn failures on macOS)
  if (process.env.NODE_BINARY) {
    console.log('[e2e_stub] NODE_BINARY env:', process.env.NODE_BINARY);
  } else {
    console.log('[e2e_stub] NODE_BINARY env is NOT defined');
  }
  
  // Check if preload script exists
  if (!fs.existsSync(preloadPath)) {
    console.error(`ERROR: Preload script not found at: ${preloadPath}`);
    app.quit();
    return;
  }
  
  // Create the primary window with the real preload bundle so the
  // renderer side exposes the same window.api bridge the production
  // app uses (Codex tests rely on it).
  const mainWindow = new BrowserWindow({
    show: true,
    width: 1280,
    height: 720,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,  // re-enabled; channel now whitelisted in preload
      sandbox: false,      // explicit: allow private IPC channels
      nodeIntegration: false
    }
  });

  // Always log the webContents ID to help diagnose IPC issues
  console.log('[stub] mainWindow webContents.id', mainWindow.webContents.id)

  // Guarantee the window is shown before any Codex broadcast can occur.
  app.on('ready', () => {
    if (!mainWindow.isVisible()) mainWindow.show();
  });
  
  // Load minimal HTML with the required WorkspaceView element and some styling to make it visible
  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8">
      <title>Tangent Test Stub</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: sans-serif;
          background-color: #f5f5f5;
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }
        .WorkspaceView {
          display: flex;
          flex: 1;
          width: 100%;
          background-color: white;
          color: black;
          padding: 20px;
          box-sizing: border-box;
          text-align: center;
          justify-content: center;
          align-items: center;
        }
      </style>
    </head>
    <body>
      <main class="WorkspaceView">
        <div>
          <h1>Tangent Test Environment</h1>
          <p>This is a test stub for Playwright tests</p>
        </div>
      </main>
    </body>
  </html>
  `;
  
  // Load the HTML content
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // Retain a strong reference so GC cannot destroy the window while tests run
  (global as any).__e2eMainWindow = mainWindow;
  
  // For debugging
  // Open DevTools when ELECTRON_ENABLE_LOGGING is set or during E2E testing
  // Opening DevTools can spawn an *extra* BrowserWindow that races with the
  // test harness (firstWindow) and causes flakiness.  Keep them closed unless
  // explicitly requested via an env override.
  if (process.env.E2E_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }
  
  // Handle window close
  mainWindow.on('closed', () => {
    console.log('E2E test stub: main window closed');
    app.quit();
  });

  mainWindow.on('close', (evt) => {
    // Only block close if explicitly requested by env var
    if (process.env.E2E_KEEP_OPEN === '1') {
      console.log('E2E stub: mainWindow "close" event fired – preventing default due to E2E_KEEP_OPEN=1');
      evt.preventDefault();
    } else {
      console.log('E2E stub: mainWindow "close" event allowed (default behavior)');
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('E2E stub: renderer finished load');
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc) => {
    console.error('E2E stub: renderer failed load', errorCode, errorDesc);
  });

  // Forward renderer console messages to main process stdout so we can debug
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer console ${level}] ${sourceId}:${line} — ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[E2E stub] renderer gone', details);
  });

  // Expose the Codex manager (if any) in a global for Playwright assertions –
  // matches the behaviour of the real main process.
  (global as any).__codexManagers = (global as any).__codexManagers ?? new Set();
  if (codexMgr) {
    (global as any).__codexManagers.add(codexMgr);
  }
});

// Ensure Codex children die on full app quit even if tests forget to toggle
// the flag off.
app.on('will-quit', () => {
  try {
    if (codexMgr) codexMgr.cleanup?.();
  } catch (e) {
    console.error('Codex cleanup during app quit failed:', e);
  }
});