import { MOCK_CODEX_PATH, DEFAULT_WORKSPACE, seedCodexOn, ensureWorkspaceScaffold, seedGlobalCodex } from './pathHelpers'
// Provide the mock Codex binary so tests pick it up automatically
process.env.MOCK_CODEX_PATH = MOCK_CODEX_PATH

// Two sequential NDJSON lines: a startup signal and an idle status.
process.env.MOCK_CODEX_ARGS = '{"type":"codex_ready"} {"type":"status","state":"idle"}'

import { test, expect } from './tangent'

test.setTimeout(60000)

// Pre-seed the flag so CodexProcessManager starts immediately once Electron boots.
ensureWorkspaceScaffold(DEFAULT_WORKSPACE);
seedCodexOn(DEFAULT_WORKSPACE);
seedGlobalCodex(true, 'test_');

test('Codex can start, emit messages in order and avoid watchdog errors', async ({ tangent }) => {
  const window = await tangent.firstWindow()

  // Flip the experimental flag on *at runtime* – the Workspace subscription
  // should instantiate CodexProcessManager automatically.
  await window.page.evaluate(() => {
    window.api.settings.patch({ enableCodexIntegration: true })
  })

  // Fail fast if the Codex child never spawned – protects against a regression
  // where the settings file is not seeded early enough.
  await expect.poll(async () => {
    return await tangent.app.evaluate(() => (global as any).__codexSpawnCount ?? 0)
  }, { timeout: 15000 }).toBeGreaterThan(0)

  // Bridge guard – ensure the preload wiring exposed window.api.codex.
  const bridgeOk = await window.page.evaluate(() => !!(window as any).api?.codex)
  expect(bridgeOk).toBe(true)

  // Listen for the first Codex message coming through the bridge.
  await window.page.evaluate(() => {
    console.log("[renderer] Setting up message listeners");
    
    // Initialize arrays
    window.__codexMessages = []
    window.__codexErrors = []
    window.__codexStatus = []
    
    // Message handler
    window.api.codex.onMessage((msg) => {
      console.log("[renderer] Received message:", JSON.stringify(msg));
      window.__codexMessages.push(msg)
    })
    
    // Error handler
    window.api.codex.onError((err) => {
      console.log("[renderer] Received error:", JSON.stringify(err));
      window.__codexErrors.push(err)
    })
    
    // Status handler
    window.api.codex.onStatus((status) => {
      console.log("[renderer] Received status:", JSON.stringify(status));
      window.__codexStatus.push(status)
    })
    
    // Exit handler
    window.api.codex.onExit((info) => {
      console.log("[renderer] Codex process exited:", JSON.stringify(info));
    })
    
    console.log("[renderer] Handlers registered successfully");
  })

  // Log important diagnostic info first if DEBUG is set
  if (process.env.DEBUG?.includes('codex')) {
    console.log("DEBUG: Setting up window.__codexMessages check interval");
    
    // Check every 500ms if messages are arriving and log for debugging
    const checkInterval = setInterval(async () => {
      const msgCount = await window.page.evaluate(() => (window as any).__codexMessages?.length || 0);
      console.log(`DEBUG: __codexMessages count = ${msgCount}`);
      
      const errCount = await window.page.evaluate(() => (window as any).__codexErrors?.length || 0);
      console.log(`DEBUG: __codexErrors count = ${errCount}`);
      
      // If errors exist, check the error message
      if (errCount > 0) {
        const errors = await window.page.evaluate(() => (window as any).__codexErrors);
        console.log(`DEBUG: Error message:`, JSON.stringify(errors));
      }
      
      // Check if we got the bridge
      const bridge = await window.page.evaluate(() => !!(window as any).api?.codex);
      console.log(`DEBUG: window.api.codex bridge exists = ${bridge}`);
      
      // Get the Codex status
      const status = await window.page.evaluate(() => (window as any).__codexStatus || []);
      console.log(`DEBUG: __codexStatus:`, JSON.stringify(status));
    }, 500);
  }
  
  // Variables to track check interval
  let checkInterval: NodeJS.Timeout | null = null;
  
  if (process.env.DEBUG?.includes('codex')) {
    checkInterval = setInterval(async () => {
      const msgCount = await window.page.evaluate(() => (window as any).__codexMessages?.length || 0);
      console.log(`DEBUG: __codexMessages count = ${msgCount}`);
    }, 500);
  }
  
  // Wait until we have both required messages (max 7 s to account for slower CI runners).
  try {
    await window.page.waitForFunction(() => {
      const msgs = (window as any).__codexMessages || [];
      return msgs.some(m => m.type === 'codex_ready') && 
             msgs.some(m => m.type === 'status' && m.state === 'idle');
    }, null, {
      timeout: 7000
    });
  } finally {
    if (checkInterval) clearInterval(checkInterval);
  }

  const messages = await window.page.evaluate(() => (window as any).__codexMessages)
  console.log('[test] Received messages:', JSON.stringify(messages));

  // Check if we have the required messages in any order
  const hasReadyMessage = messages.some(msg => msg.type === 'codex_ready');
  const hasIdleStatus = messages.some(msg => msg.type === 'status' && msg.state === 'idle');
  
  expect(hasReadyMessage).toBe(true);
  expect(hasIdleStatus).toBe(true);
  
  // For debug purposes, print the messages we received if DEBUG is set
  if (process.env.DEBUG?.includes('codex')) {
    console.log("Received messages:", JSON.stringify(messages));
  }

  // Verify the message order - messages should be received in the same order
  // they were sent from the mock
  const messageTypes = messages.map(msg => msg.type);
  expect(messageTypes).toEqual(expect.arrayContaining(['codex_ready', 'status']));
  
  // Verify the index of codex_ready comes before status(idle) as specified in mock args
  const readyIndex = messageTypes.indexOf('codex_ready');
  const idleStatusIndex = messageTypes.findIndex(type => type === 'status');
  expect(readyIndex).toBeLessThan(idleStatusIndex);

  // Wait a little longer than the first-JSON watchdog (5s) grace period to be
  // absolutely certain no `codex:error` was emitted.
  await window.page.waitForTimeout(5500)

  const errors = await window.page.evaluate(() => (window as any).__codexErrors)
  expect(errors.length).toBe(0)
})
