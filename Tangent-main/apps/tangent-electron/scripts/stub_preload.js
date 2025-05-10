const { contextBridge, ipcRenderer } = require('electron');
// Gate debug logging; set DEBUG=codex or MOCK_CODEX_DEBUG=1 to see diagnostic logs
const DEBUG = process.env.DEBUG?.includes('codex') || process.env.MOCK_CODEX_DEBUG === '1' || process.env.PLAYWRIGHT_IN_DOCKER === '1';
function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

// Log critical diagnostic information only if debug is enabled
if (DEBUG) {
  console.log('[PRELOAD] Preload script loaded and running');
}

// Define a fallback path that will always work in the container
const defaultCodexPath = '/repo/scripts/mock_codex_headless.js';
        
// Diagnostic environment dump
if (DEBUG) {
  console.log('[PRELOAD] process.env.MOCK_CODEX_PATH =', process.env.MOCK_CODEX_PATH);
  console.log('[PRELOAD] defaultCodexPath =', defaultCodexPath);
  console.log('[PRELOAD] All env vars:', 
    Object.keys(process.env)
      .filter(key => key.includes('CODEX') || key.includes('MOCK') || key.includes('ELECTRON') || key.includes('PLAYWRIGHT'))
      .reduce((obj, key) => ({ ...obj, [key]: process.env[key] }), {})
  );
}
        
// Store path and args for consistent access, using fallback if needed
const mockCodexPath = process.env.MOCK_CODEX_PATH || defaultCodexPath;
const mockCodexArgs = process.env.MOCK_CODEX_ARGS || '';
        
// Report chosen mock path
if (DEBUG) {
  console.log('[PRELOAD] Using mockCodexPath =', mockCodexPath);
}

// Establish early message buffers to catch messages before handlers are attached
const earlyMessages = [];
const earlyErrors = [];
const earlyStatuses = [];

// Create variables to store page handlers
let pageMessageHandler = null;
let pageErrorHandler = null;
let pageStatusHandler = null;

// Listen for messages and maintain connection for the entire page lifetime
ipcRenderer.on('codex:message', (_e, msg) => {
  if (DEBUG) {
    console.log('[PRELOAD] Received codex:message:', JSON.stringify(msg).substring(0, 200));
  }
  // Forward to page handler if registered, otherwise buffer
  if (pageMessageHandler) {
    pageMessageHandler(msg);
  } else {
    earlyMessages.push(msg);
  }
});

ipcRenderer.on('codex:error', (_e, err) => {
  if (DEBUG) {
    console.log('[PRELOAD] Received codex:error:', JSON.stringify(err).substring(0, 200));
  }
  // Forward to page handler if registered, otherwise buffer
  if (pageErrorHandler) {
    pageErrorHandler(err);
  } else {
    earlyErrors.push(err);
  }
});

ipcRenderer.on('codex:status', (_e, status) => {
  if (DEBUG) {
    console.log('[PRELOAD] Received codex:status:', JSON.stringify(status).substring(0, 200));
  }
  // Forward to page handler if registered, otherwise buffer
  if (pageStatusHandler) {
    pageStatusHandler(status);
  } else {
    earlyStatuses.push(status);
  }
});

contextBridge.exposeInMainWorld('api', {
  settings: {
    patch: cfg => {
      if (DEBUG) {
        console.log('[PRELOAD] Sending settings:patch:', JSON.stringify(cfg));
      }
      ipcRenderer.send('settings:patch', cfg);
    }
  },
  codex: {
    // Start Codex with conditional logging
    start: () => {
      if (DEBUG) {
        console.log('[PRELOAD] invoking codex:start with path:', mockCodexPath);
        if (!mockCodexPath) {
          console.error('[PRELOAD] ERROR: mockCodexPath is empty or undefined!');
        }
      }
      return ipcRenderer.invoke(
        'codex:start',
        mockCodexPath,
        mockCodexArgs
      );
    },
    stop: () => {
      if (DEBUG) {
        console.log('[PRELOAD] codex.stop called');
      }
    },
    send: text => {
      if (DEBUG) {
        console.log('[PRELOAD] codex.send:', text);
      }
      ipcRenderer.send('codex:send', text);
    },
    onMessage: cb => {
      if (DEBUG) {
        console.log('[PRELOAD] codex.onMessage registered, buffered messages:', earlyMessages.length);
      }
      
      // Store the page handler
      pageMessageHandler = cb;
      
      // Flush any early messages that were received before the handler was attached
      if (earlyMessages.length > 0) {
        if (DEBUG) {
          console.log('[PRELOAD] Flushing', earlyMessages.length, 'buffered messages');
        }
        earlyMessages.forEach(msg => cb(msg));
        earlyMessages.length = 0; // Clear the buffer after flushing
      }
      
      // Return unsubscribe function
      return () => {
        if (pageMessageHandler === cb) {
          pageMessageHandler = null;
        }
      };
    },
    onError: cb => {
      if (DEBUG) {
        console.log('[PRELOAD] codex.onError registered, buffered errors:', earlyErrors.length);
      }
      
      // Store the page handler
      pageErrorHandler = cb;
      
      // Flush early errors
      if (earlyErrors.length > 0) {
        if (DEBUG) {
          console.log('[PRELOAD] Flushing', earlyErrors.length, 'buffered errors');
        }
        earlyErrors.forEach(err => cb(err));
        earlyErrors.length = 0;
      }
      
      // Return unsubscribe function
      return () => {
        if (pageErrorHandler === cb) {
          pageErrorHandler = null;
        }
      };
    },
    onStatus: cb => {
      if (DEBUG) {
        console.log('[PRELOAD] codex.onStatus registered, buffered statuses:', earlyStatuses.length);
      }
      
      // Store the page handler
      pageStatusHandler = cb;
      
      // Flush early statuses
      if (earlyStatuses.length > 0) {
        if (DEBUG) {
          console.log('[PRELOAD] Flushing', earlyStatuses.length, 'buffered statuses');
        }
        earlyStatuses.forEach(status => cb(status));
        earlyStatuses.length = 0;
      }
      
      // Return unsubscribe function
      return () => {
        if (pageStatusHandler === cb) {
          pageStatusHandler = null;
        }
      };
    },
    onExit: cb => {
      if (DEBUG) {
        console.log('[PRELOAD] codex.onExit registered');
      }
      
      // Create exit handler variable parallel to other handlers
      let pageExitHandler = cb;
      
      // Set up persistent exit handler
      ipcRenderer.on('codex:exit', (_e, info) => {
        if (DEBUG) {
          console.log('[PRELOAD] Forwarding exit info to renderer:', JSON.stringify(info).substring(0, 200));
        }
        if (pageExitHandler) {
          pageExitHandler(info);
        }
      });
      
      // Return unsubscribe function
      return () => {
        if (pageExitHandler === cb) {
          pageExitHandler = null;
        }
      };
    }
  }
});