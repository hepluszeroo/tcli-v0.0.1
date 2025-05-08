import { MOCK_CODEX_PATH, DEFAULT_WORKSPACE, seedCodexOn, ensureWorkspaceScaffold, seedGlobalCodex } from './pathHelpers'
// Mock binary path shared across all Codex integration specs.
process.env.MOCK_CODEX_PATH = MOCK_CODEX_PATH

// Emit an oversize junk line (1.2 MiB) followed by a valid JSON line.  The
// main process should broadcast a `codex:error` *then* the valid object.
process.env.MOCK_CODEX_ARGS = '--oversize 1200000 {"type":"ok"}'

import { test, expect } from './tangent'

test.setTimeout(60000)

ensureWorkspaceScaffold(DEFAULT_WORKSPACE);
seedCodexOn(DEFAULT_WORKSPACE);
seedGlobalCodex(true, 'test_');

test('Oversize line triggers codex:error but stream continues', async ({ tangent }) => {
  const window = await tangent.firstWindow()

  // Enable integration.
  await window.page.evaluate(() => {
    window.api.settings.patch({ enableCodexIntegration: true })
  })

  await expect.poll(async () => {
    return await tangent.app.evaluate(() => (global as any).__codexSpawnCount ?? 0)
  }, { timeout: 15000 }).toBeGreaterThan(0)

  const bridgeOk = await window.page.evaluate(() => !!(window as any).api?.codex)
  expect(bridgeOk).toBe(true)

  await window.page.evaluate(() => {
    window.__codexErrors = []
    window.__codexMessages = []
    window.api.codex.onError((err) => {
      window.__codexErrors.push(err)
    })
    window.api.codex.onMessage((msg) => {
      window.__codexMessages.push(msg)
    })
  })

  // Wait for at least one error and specifically for the {type:"ok"} message (max 12 s for slower CI).
  await window.page.waitForFunction(() => {
    const w: any = window as any
    return w.__codexErrors.length > 0 && 
           w.__codexMessages.some(msg => msg.type === 'ok')
  }, null, {
    timeout: 12000
  })
  
  console.log('[test] Waiting completed for error and ok message')

  const [firstError] = await window.page.evaluate(() => (window as any).__codexErrors)

  // The error should reference the oversize condition but *not* include the
  // entire 1.2 MiB junk line.  We enforce that by asserting a sensible upper
  // bound on the message length and the presence of an ellipsis.
  expect(firstError.message).toMatch(/oversize|too\s*large/i)
  expect(firstError.message.length).toBeLessThan(400)
  expect(firstError.message).toMatch(/…|\.\.\./)

  // Get all messages and find the one with 'ok' type
  const messages = await window.page.evaluate(() => (window as any).__codexMessages)
  
  // Log messages for debugging only if DEBUG is set
  if (process.env.DEBUG?.includes('codex')) {
    console.log('Received messages:', JSON.stringify(messages));
  }
  
  // Find the 'ok' message instead of assuming it's the first one
  const okMessage = messages.find(msg => msg.type === 'ok')
  expect(okMessage).toBeDefined()
  expect(okMessage).toMatchObject({ type: 'ok' })
  
  // Verify error message truncation works as expected
  // The error message should include a preview of the oversized line
  expect(firstError.message.length).toBeLessThan(400) // Message should be reasonably sized
  
  // Verify that parser continues to work after handling an oversized line
  // The fact that we received the 'ok' message proves the parser recovered
  // Additional assertion for clarity:
  expect(messages.length).toBeGreaterThan(0)
  
  // Ensure that no duplicate errors were generated for the same oversize line
  const errorCount = await window.page.evaluate(() => (window as any).__codexErrors.length)
  expect(errorCount).toBe(1) // Should only have one error for the oversize line
})
