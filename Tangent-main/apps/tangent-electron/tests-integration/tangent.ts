import fs from 'fs'
import { test as base } from '@playwright/test'
// We no longer use Playwright's _electron helper – instead we spawn Electron
// manually and attach via WebSocket to avoid the early-exit handshake issue.
import { launchElectron } from './electronHarness'

import path from 'path'
import os from 'os'
import TangentApp from './TangentApp'

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

export const defaultWorkspace = path.resolve(path.join(
	__dirname, '../../IntegrationTestWorkspace'))

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
		// Prepare an isolated Electron *userData* directory so that Tangent’s
		// profile registry (`workspaces.json`) exists and does not interfere
		// with the developer’s real profile.
		// ------------------------------------------------------------------
		// Determine the platform default Tangent profile dir so we can seed a
		// minimal workspace registry. If the directory doesn’t exist the main
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

const buildDir = path.resolve(__dirname, '../../__build')

// ---------------------------------------------------------------------------
// Determine the Electron binary to launch
//   • Inside Docker  (PLAYWRIGHT_IN_DOCKER=1)  → use the binary that comes with
//     the npm "electron" package (resolved by `require('electron')`).
//   • macOS host → prefer the vendored .app bundle committed under
//     third_party/electron; fall back to npm binary if the bundle is missing.
//   • Any other host (Linux developers, CI) → npm binary.
// ---------------------------------------------------------------------------

function getElectronExec(): string {
  function npmElectronBinary(): string | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('electron') as unknown as string
    } catch {
      return null
    }
  }

  // Running inside our dedicated Docker image
  if (process.env.PLAYWRIGHT_IN_DOCKER) {
    const bin = npmElectronBinary()
    if (bin) return bin
  }

  // macOS developer machines – attempt vendored bundle first
  if (process.platform === 'darwin') {
    const bundle = path.resolve(
      __dirname,
      '../../../../third_party/electron/darwin/Electron.app'
    )
    if (fs.existsSync(bundle)) {
      return bundle // pass the .app root; Playwright will pick inner binary
    }
  }

  // Default / fallback to npm-installed binary
  const npmBin = npmElectronBinary()
  if (npmBin) return npmBin

  throw new Error('Cannot resolve Electron binary via npm or vendored bundle')
}

const execPath = getElectronExec()

if (!fs.existsSync(execPath)) {
  throw new Error(`Electron executable not found at ${execPath}`)
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
		await tangentApp.close()
		child.kill('SIGKILL')

		await wait(500)

		if (resetWorkspace && workspace) {
			if (resetWorkspace === true) {
				await fs.promises.rm(workspace, { recursive: true })
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
