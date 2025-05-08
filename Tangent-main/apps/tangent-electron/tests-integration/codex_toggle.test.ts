import { MOCK_CODEX_PATH, DEFAULT_WORKSPACE, seedCodexOn, ensureWorkspaceScaffold, seedGlobalCodex } from './pathHelpers'
// Provide the mock Codex binary path for host and Docker
process.env.MOCK_CODEX_PATH = MOCK_CODEX_PATH
// Produce a steady stream of simple messages so we can observe stops/restarts.
process.env.MOCK_CODEX_ARGS = '{"type":"ping"}'

import { test, expect } from './tangent'

test.setTimeout(60000)

ensureWorkspaceScaffold(DEFAULT_WORKSPACE);
seedCodexOn(DEFAULT_WORKSPACE);
seedGlobalCodex(true, 'test_');


test('Toggling the flag stops and restarts Codex without duplicate spawns', async ({ tangent }) => {
  const window = await tangent.firstWindow()

  // Helpers to capture status events.
  await window.page.evaluate(() => {
    window.__codexStatus = []
    window.api.codex.onStatus((s) => window.__codexStatus.push(s))
  })

  // Enable → should start child and emit running:true
  await window.page.evaluate(() => {
    window.api.settings.patch({ enableCodexIntegration: true })
  })

  // Ensure the manager actually spawned before we proceed with toggling.
  await expect.poll(async () => {
    return await tangent.app.evaluate(() => (global as any).__codexSpawnCount ?? 0)
  }, { timeout: 15000 }).toBeGreaterThan(0)

  const bridgeOk1 = await window.page.evaluate(() => !!(window as any).api?.codex)
  expect(bridgeOk1).toBe(true)
  // Send a few prompts while Codex is running to make sure stdin path works.
  await window.page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      window.api.codex.send(JSON.stringify({ type: 'user', text: `ping ${i}` }))
    }
  })


  await window.page.waitForFunction(() => {
    const status = (window as any).__codexStatus
    return status.some((s) => s.running === true)
  }, null, { timeout: 7000 })

  // Disable → manager should stop and emit running:false
  await window.page.evaluate(() => {
    window.api.settings.patch({ enableCodexIntegration: false })
  })

  await window.page.waitForFunction(() => {
    const status = (window as any).__codexStatus
    return status.some((s) => s.running === false)
  }, null, { timeout: 7000 })

  // Re-enable → expect another running:true
  await window.page.evaluate(() => {
    window.api.settings.patch({ enableCodexIntegration: true })
  })

  await window.page.waitForFunction(() => {
    const status = (window as any).__codexStatus
    return (
      status.filter((s) => s.running === true).length >= 2 &&
      status.some((s) => s.running === false)
    )
  }, null, { timeout: 7000 })

  // Basic assertion: we saw the on → off → on sequence.
  const status = await window.page.evaluate(() => (window as any).__codexStatus)

  // Expect at least three status objects covering the pattern.
  const pattern = status.map((s) => s.running)

  expect(pattern).toContain(true)
  expect(pattern).toContain(false)

  // Verify the Electron main process spawned at most two Codex children
  // (one for each enable cycle) – proves we did not leak processes.
  const spawnCount = await tangent.app.evaluate(() => (global as any).__codexSpawnCount ?? 0)
  expect(spawnCount).toBeLessThanOrEqual(2)
  
  // Verify that exactly the expected number of status updates were received
  // We should see at least one running:true, one running:false, and another running:true
  const statusCount = await window.page.evaluate(() => (window as any).__codexStatus.length)
  expect(statusCount).toBeGreaterThanOrEqual(3)
  
  // Ensure no duplicate processes are running by checking if the active pids count
  // matches the expected count (should be 1 when running, 0 when disabled)
  const activePids = await tangent.app.evaluate(() => (global as any).__codexActivePids?.size ?? 0)
  const currentlyEnabled = await window.page.evaluate(() => 
    window.api.settings.get().enableCodexIntegration)
  
  // If currently enabled, we should have exactly one active Codex process
  if (currentlyEnabled) {
    expect(activePids).toBe(1)
  } else {
    expect(activePids).toBe(0)
  }
})
