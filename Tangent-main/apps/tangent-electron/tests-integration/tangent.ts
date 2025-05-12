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
  console.log('[tangent.ts] Current working directory:', process.cwd());
  console.log('[tangent.ts] Node version:', process.version);
  console.log('[tangent.ts] Platform:', process.platform);
  console.log('[tangent.ts] In Docker:', process.env.PLAYWRIGHT_IN_DOCKER === '1' ? 'Yes' : 'No');

  // In Docker environment, point Playwright at the npm Electron CLI wrapper.
  if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
    console.log('[tangent.ts] Docker environment detected. Using electron/cli.js wrapper');

    // The CLI wrapper resolves the correct dist/electron binary and is what Playwright expects.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cliPath = require.resolve('electron/cli.js');
    console.log('[tangent.ts] Resolved electron CLI:', cliPath);
    return cliPath;
  }

  // UPDATED: We no longer use executablePath() as it doesn't exist in Playwright 1.52
  try {
    // Rather than using the non-existent executablePath() method, we'll rely on well-known paths
    // and our Docker-specific fallbacks which are more reliable anyway
    console.log('[tangent.ts] Playwright executablePath() is not supported in version 1.52, using fallbacks')

    // For Docker environments, we've already handled this above
    if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
      throw new Error('Skipping Playwright Electron path in Docker - using Docker-specific paths instead')
    }

    // For non-Docker environments, check the common Electron binary locations
    const commonPaths = [
      // Try typical npm install locations
      path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron'),
      path.join(process.cwd(), 'node_modules', '.bin', 'electron'),
      // Add more common paths as needed
    ]

    for (const possiblePath of commonPaths) {
      console.log('[tangent.ts] Checking for Electron at:', possiblePath)
      if (fs.existsSync(possiblePath)) {
        console.log('[tangent.ts] Found Electron at:', possiblePath)

        // Check if the file is executable
        try {
          const stats = fs.statSync(possiblePath)
          console.log('[tangent.ts] Electron binary stats:', {
            size: stats.size,
            mode: stats.mode.toString(8),
            isExecutable: !!(stats.mode & 0o111)
          })

          if (!(stats.mode & 0o111)) {
            console.warn('[tangent.ts] WARNING: Electron binary is not executable!')
            // Make it executable if needed
            try {
              fs.chmodSync(possiblePath, 0o755);
              console.log('[tangent.ts] Made Electron binary executable');
            } catch (chmodErr) {
              console.warn('[tangent.ts] Could not make binary executable:', chmodErr);
            }
          }
        } catch (statsError) {
          console.error('[tangent.ts] Error checking Electron stats:', statsError)
        }

        return possiblePath
      }
    }

    // If we get here, none of the common paths worked
    throw new Error('No Electron binary found in common locations')
  } catch (error) {
    console.error('[tangent.ts] Failed to get Playwright Electron path:', error)

    // Fallback to npm-installed binary if Playwright's isn't available
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electronPath = require('electron') as unknown as string
      console.log('[tangent.ts] Using npm-installed Electron:', electronPath)

      // Additional diagnostics for what require('electron') resolved to
      console.log('[tangent.ts] Type of electronPath:', typeof electronPath);
      if (typeof electronPath === 'string') {
        console.log('[tangent.ts] Path length:', electronPath.length);
      } else {
        console.log('[tangent.ts] electron is not a string, stringified value:', JSON.stringify(electronPath));
      }

      // Validate path exists
      if (typeof electronPath === 'string' && fs.existsSync(electronPath)) {
        return electronPath;
      } else {
        console.error('[tangent.ts] npm Electron path does not exist or is not a valid path');

        // If it's not a string, it might be an object - try to extract path
        if (typeof electronPath === 'object' && electronPath !== null) {
          const extractedPath = (electronPath as any).path || (electronPath as any).execPath;
          if (extractedPath && typeof extractedPath === 'string' && fs.existsSync(extractedPath)) {
            console.log('[tangent.ts] Extracted path from electron object:', extractedPath);
            return extractedPath;
          }
        }

        throw new Error(`npm Electron path is not valid: ${electronPath}`);
      }
    } catch (fallbackError) {
      console.error('[tangent.ts] Fallback to npm electron failed:', fallbackError)

      // Enhanced fallback for Docker environment with additional paths
      if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
        try {
          // Project-specific paths first - absolute paths for the Docker container
          const possiblePaths = [
            // Standard locations
            '/repo/node_modules/.bin/electron',
            '/repo/node_modules/electron/dist/electron',

            // pnpm store paths
            '/repo/node_modules/.pnpm/electron@35.2.1/node_modules/electron/dist/electron',

            // Playwright paths
            '/ms-playwright/node_modules/.bin/electron',

            // Relative to CWD (process.cwd())
            path.resolve(process.cwd(), 'node_modules/electron/dist/electron'),
            path.resolve(process.cwd(), 'node_modules/.bin/electron')
          ];

          console.log('[tangent.ts] Attempting Docker fallbacks for Electron binary...');
          for (const candidatePath of possiblePaths) {
            if (fs.existsSync(candidatePath)) {
              console.log('[tangent.ts] Found Electron at:', candidatePath);

              // Make it executable
              try {
                fs.chmodSync(candidatePath, 0o755);
                console.log('[tangent.ts] Made Electron binary executable');
              } catch (chmodErr) {
                console.warn('[tangent.ts] Could not make binary executable:', chmodErr);
              }

              return candidatePath;
            } else {
              console.log('[tangent.ts] Electron not found at:', candidatePath);
            }
          }

          // Last resort: use find to locate any electron binary
          try {
            const { execSync } = require('child_process');
            const result = execSync('find /repo -name electron -type f | head -n 5', {
              encoding: 'utf8',
              timeout: 10000
            });

            if (result.trim()) {
              const files = result.trim().split('\n');
              console.log('[tangent.ts] Found potential Electron binaries:');
              files.forEach(file => console.log(`  - ${file}`));

              if (files.length > 0) {
                const foundPath = files[0];
                console.log('[tangent.ts] Using first match:', foundPath);

                // Make it executable
                try {
                  fs.chmodSync(foundPath, 0o755);
                  console.log('[tangent.ts] Made Electron binary executable');
                } catch (chmodErr) {
                  console.warn('[tangent.ts] Could not make binary executable:', chmodErr);
                }

                // Save for other tests
                try {
                  fs.writeFileSync('/tmp/electron-binary-path.txt', foundPath);
                  console.log('[tangent.ts] Saved Electron binary path to file');
                } catch (writeErr) {
                  console.warn('[tangent.ts] Could not save path to file:', writeErr);
                }

                return foundPath;
              }
            } else {
              console.log('[tangent.ts] No files found in broader search');
            }
          } catch (findErr) {
            console.error('[tangent.ts] Error during broader search:', findErr);
          }
        } catch (dockerError) {
          console.error('[tangent.ts] Docker fallback failed:', dockerError)
        }
      }

      throw new Error('Cannot resolve Electron binary via Playwright, npm, or Docker fallbacks')
    }
  }
}

// Add additional safeguards for Electron binary resolution
let execPath: string
try {
  execPath = getElectronExec()
  console.log('[tangent.ts] Successfully resolved Electron path:', execPath)
} catch (error) {
  console.error('[tangent.ts] CRITICAL ERROR: Failed to get Electron binary path:', error)
  throw new Error(`Failed to resolve Electron binary: ${error}`)
}

// Fail early with a friendly hint when the Electron binary is missing
if (!fs.existsSync(execPath)) {
  // Try one last fallback for Docker environments
  if (process.env.PLAYWRIGHT_IN_DOCKER === '1') {
    console.error('[tangent.ts] Final attempt to find Electron binary in Docker...')

    const lastResortPaths = [
      '/ms-playwright/node_modules/electron/dist/electron',
      '/usr/local/bin/electron'
    ]

    for (const path of lastResortPaths) {
      if (fs.existsSync(path)) {
        console.log('[tangent.ts] Found last-resort Electron at:', path)
        execPath = path
        break
      }
    }

    if (!fs.existsSync(execPath)) {
      console.error('[tangent.ts] All fallbacks exhausted. Aborting.')
      throw new Error(
        `Electron executable not found at ${execPath} or any fallback locations. ` +
        'Ensure Electron is properly installed in the Docker container.'
      )
    }
  } else {
    throw new Error(
      `Electron executable not found at ${execPath}. ` +
      'Make sure Playwright is properly installed with browsers.'
    )
  }
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