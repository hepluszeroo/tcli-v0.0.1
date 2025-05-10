import { describe, test, expect } from 'vitest'

import Settings from './Settings'
import Setting from './Setting'

describe('Setting serialization', () => {
	test('Setting does not send files for changes', () => {
		const setting = new Setting({
			defaultValue: 'foo'
		})

		expect(setting.value).toEqual('foo')
		expect(setting.getRawValues('file')).toBeUndefined()
	})

	test('Settings do not store default values', () => {
		const settings = new Settings()
		const raw = settings.getRawValues('file') as any
		expect(raw?.updateChannel).toBeUndefined
	})

	// New test: enableCodexIntegration default & persistence
	test('enableCodexIntegration flag round-trips correctly', () => {
		const settings = new Settings()
		// default should be false
		expect(settings.enableCodexIntegration.value).toBe(false)

		// flip true → false → true
		settings.enableCodexIntegration.set(true)
		expect(settings.enableCodexIntegration.value).toBe(true)
		settings.enableCodexIntegration.set(false)
		settings.enableCodexIntegration.set(true)

		const patch = settings.getRawValues('patch') as any
		const clone = new Settings()
		clone.applyPatch?.(patch)
		expect(clone.enableCodexIntegration.value).toBe(true)
	})
})
