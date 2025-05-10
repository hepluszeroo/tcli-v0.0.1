import path from 'path';

/**
 * Centralized paths for integration tests, valid in both host and Docker CI.
 */
export const PLAYWRIGHT_IN_DOCKER = process.env.PLAYWRIGHT_IN_DOCKER === '1';

// ---------------------------------------------------------------------------
// Canonical workspace path that BOTH the Playwright harness *and* every helper
// function must agree on.  Keeping a single constant, derived only from the
// execution environment (host vs Docker), eliminates the long-standing bug
// where the seed-settings file was written to one directory while Tangent was
// launched with another – a mismatch that silently disabled the
// `enableCodexIntegration` flag and made the Codex tests hang.
// ---------------------------------------------------------------------------

export const DEFAULT_WORKSPACE = PLAYWRIGHT_IN_DOCKER
  ? '/repo/Tangent-main/apps/IntegrationTestWorkspace' // absolute path inside the Docker image
  : path.resolve(__dirname, '../../IntegrationTestWorkspace'); // host path – resolved once so tests & harness share it

export const MOCK_CODEX_PATH = PLAYWRIGHT_IN_DOCKER
  ? '/repo/scripts/mock_codex_headless.js'
  : path.resolve(__dirname, '../../../../scripts/mock_codex_headless.js');

/**
 * Prepare the workspace directory so Tangent recognises it as an existing
 * workspace and does NOT create a sibling directory with a numeric suffix.
 */
export function ensureWorkspaceScaffold(workspace: string): void {
  const fs = require('fs') as typeof import('fs');
  const p = require('path') as typeof import('path');

  fs.mkdirSync(p.join(workspace, '.tangent'), { recursive: true });
}

/**
 * Timeout (ms) for the WorkspaceView selector that gates readiness of a
 * window during integration tests.  We allow a longer budget on CI runners
 * which tend to have slower I/O and no GPU acceleration.
 */
// Allow more head-room on CI where cold Electron starts are slower.
// Allow generous head-room on CI where Electron cold starts plus workspace
// index-parsing can take noticeably longer, especially when Codex spawns
// during boot.  We still keep the local timeout tighter to surface genuine
// hangs quickly when running the suite on a developer machine.
export const WORKSPACE_VIEW_TIMEOUT = process.env.CI ? 90_000 : 60_000;

/**
 * Ensure the workspace settings file exists **before** Electron launches so
 * the main process picks up `enableCodexIntegration:true` on first load.
 */
/**
 * Create (or overwrite) the workspace settings file before Electron boots so
 * the main process reads the desired Codex integration flag on first load.
 *
 * Passing `flag=true` (the default) will start Codex immediately during app
 * start-up; when `flag=false` a test can flip the flag later at runtime via
 * the preload bridge.  Keeping the default *false* preserves the historical
 * behaviour of the suite while still guaranteeing the path is correct.
 */
export function seedCodexOn(
  workspace: string = DEFAULT_WORKSPACE,
  flag: boolean = true
): void {
  // Historical helper kept so existing specs keep importing the same name, but
  // we now only make sure the workspace *scaffold* is present.  Enabling the
  // flag before Electron boots caused CodexProcessManager to evaluate while no
  // renderer windows were yet attached, so the process never spawned.  The
  // actual toggle is performed at runtime inside each test via
  // `window.api.settings.patch({ enableCodexIntegration: true })` which
  // guarantees the observers list is populated.

  const fs = require('fs') as typeof import('fs');
  const p = require('path') as typeof import('path');

  ensureWorkspaceScaffold(workspace);

  // Seed a minimal settings file so the workspace is recognised as fully
  // initialised and Tangent will not create a sibling “(1)” directory on first
  // run.  The `enableCodexIntegration` flag is written according to the
  // `flag` argument so individual specs can choose the most suitable startup
  // behaviour without duplicating JSON-writing boilerplate.

  try {
    fs.writeFileSync(
      p.join(workspace, '.tangent', 'settings.json'),
      JSON.stringify({ enableCodexIntegration: flag })
    );
  } catch {
    /* best-effort – the tests will fail later if the file is really needed */
  }
}

// ---------------------------------------------------------------------------
// Global settings seeding – the Electron main process reads its profile-wide
// settings (not workspace-scoped) from `app.getPath('userData')/settings.json`.
// If the Codex flag does not exist **at all** when `Workspace` instances are
// constructed the `settings.enableCodexIntegration.subscribe()` handler has
// nothing to listen to, so later runtime patches add a *new* observable that
// the handler is unaware of.  The result: no CodexProcessManager ever spawns.
//
// To guarantee the observable exists *before* the subscription happens we
// create the settings file with the desired initial value inside the profile
// directory that the test harness will use (see TangentWindow fixture).
// ---------------------------------------------------------------------------

export function seedGlobalCodex(flag: boolean = true, prefix = 'test_'): void {
  const fs = require('fs') as typeof import('fs')
  const p = require('path') as typeof import('path')
  const os = require('os') as typeof import('os')

  function profileDir(): string {
    if (process.platform === 'darwin') {
      return p.join(os.homedir(), 'Library', 'Application Support', 'Tangent')
    }
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA ?? p.join(os.homedir(), 'AppData', 'Roaming')
      return p.join(appData, 'Tangent')
    }
    // linux & others
    const configHome = process.env.XDG_CONFIG_HOME ?? p.join(os.homedir(), '.config')
    return p.join(configHome, 'Tangent')
  }

  const dir = profileDir()
  fs.mkdirSync(dir, { recursive: true })

  // The runtime code prefixes the filename with getWorkspaceNamePrefix(). We
  // replicate the same logic so the file is actually picked up.
  const prefixName = prefix ?? ''

  const settingsPath = p.join(dir, `${prefixName}settings.json`)
  try {
    const existing = fs.existsSync(settingsPath)
      ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      : {}

    existing.enableCodexIntegration = flag

    fs.mkdirSync(p.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(existing))
  } catch {
    /* best-effort */
  }
}