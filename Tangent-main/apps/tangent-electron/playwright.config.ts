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
	projects: [
		{
			name: 'Tests',
			testMatch: /.*tests-integration.*\.test\.(ts)/,
		},
		{
			name: 'Benchmarks',
			testMatch: /.*tests-integration.*\.bench\.(ts)/,
		},
		{
			name: 'Screenshots',
			testMatch: /.*tests-integration.*\.screenshot\.ts/,
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
