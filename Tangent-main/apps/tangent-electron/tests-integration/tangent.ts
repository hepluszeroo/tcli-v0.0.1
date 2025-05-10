import fs from 'fs'
import { test as base } from '@playwright/test'
// We no longer use Playwright's _electron helper – instead we spawn Electron
// manually and attach via WebSocket to avoid the early-exit handshake issue.
import { launchElectron } from './electronHarness'

import path from 'path'
import os from 'os'
import TangentApp from './TangentApp'
import { DEFAULT_WORKSPACE } from './pathHelpers'

// Using this here because playwright doesn't want to play nice with ESM imports
export function wait(time: number = 0): Promise<void> {
	return new Promise((resolve, reject) => {
		setTimeout(resolve, time)
	})
}

export type TangentOptions = {
	workspaceInfoName: string
	workspace: string
	resetWorkspaceInfo: boolean
	// When true, will delete the entire workspace when finished
	// When a string, will delete tangents & workspaces with that prefix
	resetWorkspace: boolean | string
}

type TangentFixtures = {
	tangent: TangentApp
}

// Workspace root is provided by pathHelpers
export const defaultWorkspace = DEFAULT_WORKSPACE

export const test = base.extend<TangentFixtures & TangentOptions>({

	workspaceInfoName: ['test_', { option: true }],
	workspace: [defaultWorkspace, { option: true }],
	resetWorkspaceInfo: [true, { option: true }],
	resetWorkspace: [true, { option: true }],

	tangent: async ({
		workspaceInfoName,
		workspace,
		resetWorkspaceInfo,
		resetWorkspace
	}, use) => {
		// Set up the app

		if (workspace) {
			await fs.promises.mkdir(workspace, { recursive: true })
		}

		// ------------------------------------------------------------------
		// Prepare an isolated Electron *userData* directory so that Tangent's
		// profile registry (`workspaces.json`) exists and does not interfere
		// with the developer's real profile.
		// ------------------------------------------------------------------
		// Determine the platform default Tangent profile dir so we can seed a
		// minimal workspace registry. If the directory doesn't exist the main
		// process will create it eventually, but pre-creating avoids first-run
		// delays and lets our cleanup logic remove the file deterministically.
		function defaultProfileDir() {
			if (process.platform === 'darwin') {
				return path.join(os.homedir(), 'Library', 'Application Support', 'Tangent')
			}
			if (process.platform === 'win32') {
				const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
				return path.join(appData, 'Tangent')
			}
			// linux
			const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
			return path.join(configHome, 'Tangent')
		}
		const profileDir = defaultProfileDir()
		const registryPath = path.join(profileDir, `${workspaceInfoName}workspaces.json`)
		try {
			await fs.promises.mkdir(profileDir, { recursive: true })
			await fs.promises.writeFile(registryPath, JSON.stringify({ knownWorkspaces: [], openWorkspaces: [] }))
		} catch (_) {/* ignore */}

// __dirname => .../apps/tangent-electron/tests-integration
// The compiled bundle lives one directory up at .../apps/tangent-electron/__build
const buildDir = path.resolve(__dirname, '../__build')

// ---------------------------------------------------------------------------
// Determine the Electron binary to launch
//   • Inside Docker  (PLAYWRIGHT_IN_DOCKER=1)  → use the binary that comes with
//     the npm "electron" package (resolved by `require('electron')`).
//   • macOS host → prefer the vendored .app bundle committed under
//     third_party/electron; fall back to npm binary if the bundle is missing.
//   • Any other host (Linux developers, CI) → npm binary.
// ---------------------------------------------------------------------------

// Part II: Use Playwright's built-in Electron executable instead of a vendored binary
// This avoids macOS Gatekeeper issues and makes the test environment consistent
// between macOS and Linux
function getElectronExec(): string {
  try {
    // Import Playwright's electron module to access its executable path
    // This is the most reliable way to get a compatible Electron binary
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const playwrightElectron = require('@playwright/test')._electron
    const electronPath = playwrightElectron.executablePath()

    console.log('[tangent.ts] Using Playwright built-in Electron:', electronPath)
    return electronPath
  } catch (error) {
    console.error('[tangent.ts] Failed to get Playwright Electron path:', error)

    // Fallback to npm-installed binary if Playwright's isn't available
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('electron') as unknown as string
    } catch (fallbackError) {
      console.error('[tangent.ts] Fallback to npm electron failed:', fallbackError)
      throw new Error('Cannot resolve Electron binary via Playwright or npm')
    }
  }
}

const execPath = getElectronExec()

// Fail early with a friendly hint when the Electron binary is missing
if (!fs.existsSync(execPath)) {
  throw new Error(
    `Electron executable not found at ${execPath}. ` +
    'Make sure Playwright is properly installed with browsers.'
  )
}

const mainEntry = path.join(buildDir, 'bundle', 'main.js')

console.log('[tangent.ts] launching Electron binary:', execPath)

const { app: electronApp, child } = await launchElectron({
  electronBinary: execPath,
  buildDir,
  mainEntry,
  workspace,
  env: {
    ...process.env,
    INTEGRATION_TEST: '1',
    WORKSPACE_NAME: workspaceInfoName,
    USE_OPEN_WRAPPER: '0'
  }
})

const tangentApp = new TangentApp(electronApp as any, workspace)

		// Use the app in a test
		await use(tangentApp)

		const userDataPath = await electronApp.evaluate(async ({ app }) => {
			return app.getPath('userData')
		})

		const workspaceInfoPath = path.join(
			userDataPath,
			workspaceInfoName + 'workspaces.json')

		// Clean up test
		// (legacy diagnostic block removed – no longer required)
    
    // Attempt graceful close – but enforce an upper bound so worker teardown
    // never hits the global 60-second limit even if Electron hangs.  If the
    // graceful shutdown takes too long we escalates to SIGKILL as a last
    // resort which guarantees Playwright can continue with other workers.

    // Make Electron block until every Codex child is actually closed.
    // We execute the IPC call in the renderer context of the first window
    // instead of (incorrectly) trying to call a non-existent evaluate()
    // helper on TangentApp itself.
    // Run the drain barrier inside Electron *main* process so we avoid the
    // contextIsolation restrictions that block `require()` in the renderer.
    try {
      await tangentApp.app.evaluate(async () => {
        const wait: Promise<void>[] = [];
        const set: Set<any> | undefined = (global as any).__codexChildObjects;
        if (set && set.size > 0) {
          for (const cp of Array.from(set)) {
            try { cp.kill('SIGKILL'); } catch {}
            wait.push(new Promise<void>((res) => cp.once('exit', res)));
          }
          await Promise.all(wait);
        }
      });

      // Guard-rail: ensure drain really cleared every Codex child.
      if (process.env.CI) {
        await tangentApp.app.evaluate(() => {
          if ((global as any).__codexChildObjects?.size) {
            throw new Error('Codex children survived cleanup');
          }
        });
      }
    } catch (e) {
      console.error('[tangent] await-drain in main process failed:', e);
    }
    


    // Explicitly quit the app via IPC to ensure proper cleanup
    try {
      await tangentApp.app.evaluate(({ app }) => {
        console.log('[tangent] Explicitly triggering app.quit() before electronApp.close()')
        app.quit() // triggers will-quit and allows clean exit
      })
    } catch (e) {
      console.error('[tangent] Failed to run app.quit():', e)
    }
    
    const CLOSE_TIMEOUT_MS = 5000 // Reduced timeout since we're actively quitting

    const closePromise = tangentApp.close()

    await Promise.race([
      closePromise,
      new Promise<void>((resolve) => {
        setTimeout(async () => {
          try {
            // Force-kill the underlying process to avoid fixture timeout
            console.log('[tangent] Close timeout reached, force-killing process')
            const proc = (tangentApp.app as any)._process as import('child_process').ChildProcess | undefined
            proc?.kill('SIGKILL')
          } catch (e) {
            console.error('[tangent] Error during force kill:', e)
          }
          resolve()
        }, CLOSE_TIMEOUT_MS)
      })
    ])
		if (child) {
			try { 
				child.kill('SIGKILL') 
			} catch (e) { 
				console.error('kill() failed', e) 
			}
		}

		await wait(500)

		if (resetWorkspace && workspace) {
			if (resetWorkspace === true) {
			// Remove the temporary workspace directory. Use `force:true` so the
			// call is idempotent and does not fail in case the directory was
			// never created or was already deleted during the test (for example
			// when running in parallel workers).
			await fs.promises.rm(workspace, { recursive: true, force: true })
			}
			else {
				try {
					const workspaceDir = path.join(workspace, '.tangent', 'workspaces')
					const workspaceFiles = await fs.promises.readdir(workspaceDir)
					for (const filename of workspaceFiles) {
						if (filename.startsWith(resetWorkspace)) {
							await fs.promises.rm(path.join(workspaceDir, filename))
						}
					}

					const tangentsDir = path.join(workspace, '.tangent', 'tangents')
					const tangentFiles = await fs.promises.readdir(tangentsDir)
					for (const filename of tangentFiles) {
						if (filename.startsWith(resetWorkspace)) {
							await fs.promises.rm(path.join(tangentsDir, filename), { recursive: true })
						}
					}
				}
				catch (e) {}
			}
		}

		if (resetWorkspaceInfo) {
			await fs.promises.rm(workspaceInfoPath, { force: true })
		}

		// Remove the registry file we created
		try {
			await fs.promises.rm(registryPath, { force: true })
		} catch (_) {/* ignore */}
	}
})

export { expect } from '@playwright/test'