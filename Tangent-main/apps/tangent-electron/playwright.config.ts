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
	// Part V: Add detailed Playwright debug logging for troubleshooting in Docker
	reporter: [['list'], ['html', { open: 'never' }]],
	// Increased timeout for Electron launch in Docker
	timeout: 60000,
	retries: 1, // Add retries to make tests more robust
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
						'--disable-dev-shm-usage',
						'--disable-setuid-sandbox',
						'--no-zygote',
						'--disable-accelerated-2d-canvas'
					],
					env: {
						// Ensure Electron logs are captured
						ELECTRON_ENABLE_LOGGING: '1',
						ELECTRON_DISABLE_SANDBOX: '1',
						ELECTRON_NO_ATTACH_CONSOLE: '1',
						DEBUG: 'electron,electron:*,pw:*'
					},
					// Increased timeout for Electron launch in Docker
					timeout: 30000
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
