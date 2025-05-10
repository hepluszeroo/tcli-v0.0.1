import path from 'path'
import { defineConfig } from '@playwright/test'
// NOTE: we only need the *types* from the helper file so importing them with
// `type` prevents Playwright from executing the helper (which registers
// `test()` blocks) during its configuration phase. Executing test code while
// the config is being parsed triggers the runtime error:
//   "Playwright Test did not expect test() to be called here."
// Converting this to a type-only import removes the side-effect.
import type { TangentOptions } from './tests-integration/tangent'

export default defineConfig<TangentOptions>({
	// Restrict Playwright's test discovery to the dedicated integration test
	// directory. This avoids accidental matches elsewhere (e.g. unit/benchmark
	// folders) and makes CLI path filters simpler across CI platforms.
	testDir: './tests-integration',
	// Part IV: Add global timeout to prevent infinite hangs
	globalTimeout: 300000, // 5 minutes max for entire suite
	projects: [
		{
			name: 'Tests',
			testMatch: /.*\.test\.(ts)/,
			// Part II: Configure Playwright's Electron launcher with optimal settings
			use: {
				// Use Playwright's built-in Electron launcher
				// This ensures a consistent environment across all platforms
				launchOptions: {
					args: [
						'--no-sandbox',
						'--disable-gpu',
						'--disable-dev-shm-usage'
					],
					env: {
						// Ensure Electron logs are captured
						ELECTRON_ENABLE_LOGGING: '1',
						ELECTRON_DISABLE_SANDBOX: '1'
					}
				}
			}
		},
		{
			name: 'Benchmarks',
			testMatch: /.*\.bench\.(ts)/,
		},
		{
			name: 'Screenshots',
			testMatch: /.*\.screenshot\.ts/,
			use: {
				workspace: path.resolve(path.join(
					__dirname, '../TestFiles/ScreenshotWorkspace/My Workspace'
				)),
				resetWorkspace: 'test'
			}
		}
	],
	workers: 1
})
