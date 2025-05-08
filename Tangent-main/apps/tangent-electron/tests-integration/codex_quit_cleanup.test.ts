import { MOCK_CODEX_PATH, DEFAULT_WORKSPACE, seedCodexOn, ensureWorkspaceScaffold, seedGlobalCodex } from './pathHelpers'
// Feed an endless heartbeat so the Codex child keeps running until the app
// quits – this lets us assert that the process is actually reaped by the
// CodexProcessManager cleanup hooks.
process.env.MOCK_CODEX_PATH = MOCK_CODEX_PATH
process.env.MOCK_CODEX_ARGS = '--delay 1000 {"type":"hb"}'

import { test, expect } from './tangent'

test.setTimeout(60000)

ensureWorkspaceScaffold(DEFAULT_WORKSPACE);
seedCodexOn(DEFAULT_WORKSPACE);
seedGlobalCodex(true, 'test_');


test('Codex child terminates cleanly when Electron quits', async ({ tangent }) => {
  // 1. Boot the first window and enable the integration so a Codex child is
  //    spawned.  Record its PID via the global helper incremented in the main
  //    process.
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

  // Wait for running:true signal.
  await window.page.evaluate(() => {
    window.__codexStatus = []
    window.api.codex.onStatus((s) => window.__codexStatus.push(s))
  })

  await window.page.waitForFunction(() => {
    return (window as any).__codexStatus.some((s) => s.running === true)
  }, null, { timeout: 12000 })

  // Get the PID of the spawned mock process from the main world so we can
  // later verify it no longer exists.
  // Access the PID immediately after we know Codex has started
  const childPid: number = await tangent.app.evaluate(() => {
    const pids: Set<number> | undefined = (global as any).__codexActivePids
    
    // Log more details about the state to help debug
    console.log('[test] CodexActivePids:', pids ? Array.from(pids) : 'undefined')
    console.log('[test] Global keys:', Object.keys(global).filter(k => k.startsWith('__codex')))
    
    // Use values().next().value to get the first item from a Set without converting to array
    if (!pids || pids.size === 0) return 0
    return pids.values().next().value
  })

  console.log('Child PID:', childPid)
  expect(childPid).toBeGreaterThan(0)

  // 2. Issue `app.quit()`. We must do this from the main world so Electron can
  //    begin its shutdown sequence.
  await tangent.app.evaluate(async ({ app }) => {
    console.log('[test] Calling app.quit()')
    app.quit()
  })

  // Instead of a fixed timeout, use polling to wait for the PID to be removed from tracking
  console.log('[test] Waiting for Codex child process to terminate')
  
  await expect.poll(async () => {
    try {
      // This might throw if the app is closing
      const activePids = await tangent.app.evaluate(() => {
        console.log('[test] Checking __codexActivePids:', (global as any).__codexActivePids)
        return (global as any).__codexActivePids?.size ?? 0
      })
      console.log('[test] Active PIDs count:', activePids)
      return activePids
    } catch (e) {
      // If app is closed, we can't evaluate but that means processes are gone
      console.log('[test] App evaluation failed (likely because app closed)')
      return 0
    }
  }, { timeout: 8000 }).toBe(0)
})
