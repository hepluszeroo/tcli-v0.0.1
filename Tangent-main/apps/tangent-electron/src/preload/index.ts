// DEBUG breadcrumb – proves compiled preload actually loads (wrapped so it
// can stay in production bundle harmlessly).
// Always log this message during integration tests to confirm preload execution
if (process.env.DEBUG?.includes('preload') || process.env.INTEGRATION_TEST === '1') {
  // eslint-disable-next-line no-console
  console.log('[preload] TOP-OF-FILE reached');
  
  // Process environment check for integration test
  console.log('[preload] INTEGRATION_TEST =', process.env.INTEGRATION_TEST);
  console.log('[preload] DEBUG =', process.env.DEBUG);
  
  // Log filesystem path to help debug path issues
  console.log('[preload] __filename =', __filename);
}

import type WindowApi from 'common/WindowApi'
import { contextBridge, ipcRenderer } from 'electron'

// ---------------------------------------------------------------------------
// Channel allow-list & early buffer.
//  • First ipcRenderer.on registration whitelists the channel under
//    context-isolation (Electron ≥24).
//  • We keep an `early` buffer so messages that arrive before the renderer
//    attaches its real listener are not lost.
// ---------------------------------------------------------------------------

// CRITICAL FIX: Use a typed buffer to store all types of early messages
const earlyBuffer: Array<{type: string, payload: any}> = [];

console.log('[preload] Setting up initial codex:message listener for early buffer');

// IMPORTANT: First register listeners to whitelist the channels in contextIsolation mode
// These listeners capture messages that arrive before the renderer attaches its handlers
ipcRenderer.on('codex:message', (_e, msg) => {
  console.log('[preload] Early buffer received codex:message:', JSON.stringify(msg).substring(0, 100));
  earlyBuffer.push({ type: 'msg', payload: msg });
});

ipcRenderer.on('codex:error', (_e, err) => {
  console.log('[preload] Early buffer received codex:error:', JSON.stringify(err).substring(0, 100));
  earlyBuffer.push({ type: 'err', payload: err });
});

ipcRenderer.on('codex:status', (_e, status) => {
  console.log('[preload] Early buffer received codex:status:', JSON.stringify(status).substring(0, 100));
  earlyBuffer.push({ type: 'status', payload: status });
});

// Leave these listeners active to ensure the channels remain whitelisted
// The buffer will be flushed when the renderer calls onMessage/onError/onStatus

// ---------------------------------------------------------------------------
// Early-message buffer & expose API (unchanged logic, just ensure it is after
// allow-list so channel is authorised).
// ---------------------------------------------------------------------------

// Temporary diagnostics for Codex E2E – guarded by env flag.
if (process.env.DEBUG?.includes('preload')) {
  // eslint-disable-next-line no-console
  console.log('[preload] loaded', __filename);
  ipcRenderer.on('codex:message', (_e, m) => {
    // eslint-disable-next-line no-console
    console.log('[preload] codex:message', m);
  });
}

// Codex IPC shared types
import { CodexChannel } from 'common/ipc_types'
// Type-only imports to avoid pulling them into the preload bundle
import type { CodexMessage, CodexStatusPayload, CodexErrorPayload } from 'common/ipc_types'

function on(channel:string,  handler: (...args) => void) {
	ipcRenderer.on(channel, (event, ...args) => {
		try {
			handler(...args)
		}
		catch (err) {
			console.error('Error parsing data', channel, args)
			console.error(err)
		}
	})
}

let bridge: WindowApi = {

	// -----------------------------------------------------------------------
	// Codex integration (Phase-3)
	// -----------------------------------------------------------------------
	codex: {
		/** Spawn Codex for current renderer's workspace (handled main-side). */
		start(workspacePath?: string) {
			return ipcRenderer.invoke(CodexChannel.Start, workspacePath ?? {})
		},

		/** Terminate Codex process associated with this window. */
		stop() {
			return ipcRenderer.invoke(CodexChannel.Stop)
		},

		/** Send a raw string (already NDJSON) to Codex stdin. */
		send(payload: string) {
			return ipcRenderer.invoke(CodexChannel.Send, payload)
		},

		// ------------------------ listeners ------------------------

		// Buffer messages that arrive before any listener is attached so that
		// early Codex output (e.g. the immediate `codex_ready` line) is not lost
		// in integration tests where the renderer registers its callback after
		// flipping the feature flag.
		onMessage(cb: (msg: CodexMessage) => void) {
			// CRITICAL FIX: Flush the early buffer when the renderer actually attaches its handler
			console.log(`[preload bridge] onMessage handler attached, early buffer size: ${earlyBuffer.filter(i => i.type === 'msg').length}`);
	    
			// Flush messages from the typed early buffer
			const earlyMessages = earlyBuffer.filter(i => i.type === 'msg');
			
			earlyMessages.forEach(item => {
				console.log(`[preload bridge] Flushing typed buffer message:`, JSON.stringify(item.payload).substring(0, 100))
				cb(item.payload)
			})
			
			// Remove processed messages from buffer
			for (let i = earlyBuffer.length - 1; i >= 0; i--) {
				if (earlyBuffer[i].type === 'msg') {
					earlyBuffer.splice(i, 1)
				}
			}
	    
			// Legacy buffer flush
			if ((window as any).__pendingCodexMsgs?.length) {
				for (const m of (window as any).__pendingCodexMsgs) {
					try { cb(m) } catch {}
				}
				(window as any).__pendingCodexMsgs.length = 0
			}

			const handler = (_e: unknown, msg: CodexMessage) => {
				console.log(`[preload bridge] Received new message via ipcRenderer:`, JSON.stringify(msg).substring(0, 100))
				cb(msg)
			}
			ipcRenderer.on(CodexChannel.Message, handler)
			return () => ipcRenderer.removeListener(CodexChannel.Message, handler)
		},

		onStatus(cb: (status: CodexStatusPayload) => void) {
			// CRITICAL FIX: Flush the early buffer when the renderer actually attaches its handler
			console.log(`[preload bridge] onStatus handler attached, early buffer size: ${earlyBuffer.filter(i => i.type === 'status').length}`);
	    
			// Flush status messages from early buffer
			const earlyStatuses = earlyBuffer.filter(i => i.type === 'status');
			
			earlyStatuses.forEach(item => {
				console.log(`[preload bridge] Flushing status message:`, JSON.stringify(item.payload).substring(0, 100))
				cb(item.payload)
			})
			
			// Remove processed entries
			for (let i = earlyBuffer.length - 1; i >= 0; i--) {
				if (earlyBuffer[i].type === 'status') {
					earlyBuffer.splice(i, 1)
				}
			}
			
			const handler = (_e: unknown, payload: CodexStatusPayload) => cb(payload)
			ipcRenderer.on(CodexChannel.Status, handler)
			return () => ipcRenderer.removeListener(CodexChannel.Status, handler)
		},

		onError(cb: (err: CodexErrorPayload) => void) {
			// CRITICAL FIX: Flush the early buffer when the renderer actually attaches its handler
			console.log(`[preload bridge] onError handler attached, early buffer size: ${earlyBuffer.filter(i => i.type === 'err').length}`);
	    
			// Flush error messages from early buffer
			const earlyErrors = earlyBuffer.filter(i => i.type === 'err');
			
			earlyErrors.forEach(item => {
				console.log(`[preload bridge] Flushing error message:`, JSON.stringify(item.payload).substring(0, 100))
				cb(item.payload)
			})
			
			// Remove processed entries
			for (let i = earlyBuffer.length - 1; i >= 0; i--) {
				if (earlyBuffer[i].type === 'err') {
					earlyBuffer.splice(i, 1)
				}
			}
			
			const handler = (_e: unknown, payload: CodexErrorPayload) => cb(payload)
			ipcRenderer.on(CodexChannel.Error, handler)
			return () => ipcRenderer.removeListener(CodexChannel.Error, handler)
		},

		/** Listener for the dedicated `codex:exit` event fired once the Codex
		 * child process terminates. Returns an unsubscribe disposer like the
		 * other helpers. */
		onExit(cb: (info: { code: number | null; signal: string | null }) => void) {
			const handler = (_e: unknown, payload: { code: number | null; signal: string | null }) =>
				cb(payload)
			ipcRenderer.on(CodexChannel.Exit, handler)
			return () => ipcRenderer.removeListener(CodexChannel.Exit, handler)
		}
	},

	getKnownWorkspaces() {
		return ipcRenderer.invoke('getKnownWorkspaces')
	},

	getWorkspace(workspacePath) {
		return ipcRenderer.invoke('getWorkspace', workspacePath)
	},

	forgetWorkspace(workspacePath) {
		return ipcRenderer.send('forgetWorkspace', workspacePath)
	},

	getWorkspaceDialog() {
		return ipcRenderer.invoke('getWorkspaceDialog')
	},

	sendWorkspaceStatePatch(patch) {
		// Invert the namming so that the message makes sense on the main side
		ipcRenderer.send('receiveWorkspaceStatePatch', patch)
	},

	onWorkspaceStatePatch(handler) {
		// Invert the namming so that the message makes sense on the main side
		on('sendWorkspaceStatePatch', handler)
	},

	sendWorkspaceViewPatch(patch) {
		// Invert the namming so that the message makes sense on the main side
		ipcRenderer.send('receiveWorkspaceViewPatch', patch)
	},

	onWorkspaceViewPatch(handler) {
		// Invert the namming so that the message makes sense on the main side
		on('sendWorkspaceViewPatch', handler)
	},

	setWorkspaceViewState(state) {
		// Invert the namming so that the message makes sense on the main side
		ipcRenderer.send('receiveWorkspaceViewState', state)
	},

	onMenuAction(handler) {
		on('onMenuAction', handler)
	},

	onGetAllMenus(handler) {
		on('getAllMenus', handler)
	},

	postMenuUpdate(content) {
		ipcRenderer.send('postMenuUpdate', content)
	},

	showContextMenu(template) {
		ipcRenderer.send('showContextMenu', template)
	},

	onWorkspaceAction(handler) {
		on('workspaceAction', handler)
	},

	onMessage(handler) {
		on('message', handler)
	},

	window: {
		close() {
			ipcRenderer.invoke('window', 'close')
		},
		minimize() {
			ipcRenderer.invoke('window', 'minimize')
		},
		toggleMaximize() {
			ipcRenderer.invoke('window', 'toggleMaximize')
		},
		create() {
			ipcRenderer.invoke('createWindow')
		},
		isAlwaysOnTop() {
			return ipcRenderer.invoke('window', 'isAlwaysOnTop')
		},
		setAlwaysOnTop(value) {
			ipcRenderer.invoke('window', 'setAlwaysOnTop', value)
		},
		setSize(size) {
			return ipcRenderer.invoke('window', 'setSize', size)
		}
	},
	system: {
		getAllFonts() {
			return ipcRenderer.invoke('getAllFonts')
		},
		getAllLanguages() {
			return ipcRenderer.invoke('getAllLanguages')
		},
		saveImageFromClipboard(contextPath) {
			return ipcRenderer.invoke('saveImageFromClipboard', contextPath)
		},
		messageDialog(options) {
			return ipcRenderer.invoke('messageDialog', options)
		}
	},
	file: {
		onTreeChange(handler) {
			on('treeChange', handler)
		},
		createFile(filepath, meta) {
			return ipcRenderer.invoke('createFile', filepath, meta)
		},
		createFolder(filepath) {
			return ipcRenderer.invoke('createFolder', filepath)
		},
		move(filepath, newPath) {
			return ipcRenderer.invoke('move', filepath, newPath)
		},
		copy(filepath, newPath) {
			return ipcRenderer.invoke('copy', filepath, newPath)
		},
		delete(filepath) {
			return ipcRenderer.invoke('delete', filepath)
		},
		openFile(filepath) {
			ipcRenderer.send('openFile', filepath)
		},
		onReceiveFileContents(handler) {
			on('receiveFileContents', handler)
		},
		closeFile(filepath) {
			ipcRenderer.send('closeFile', filepath)
		},
		updateFile(filepath, content) {
			ipcRenderer.send('updateFile', filepath, content)
		},
		showInFileBrowser(path) {
			ipcRenderer.send('showInFileBrowser', path)
		},
		selectPath(options) {
			return ipcRenderer.invoke('selectPath', options)
		},
		openPath(path) {
			ipcRenderer.invoke('openPath', path)
		},
	},
	edit: {
		nativeAction(action) {
			ipcRenderer.send('edit-native', action)
		},
		onPastePlaintext(handler) {
			on('pastePlaintext', handler)
		}
	},
	links: {
		openExternal(path) {
			ipcRenderer.invoke('openExternal', path)
		},
		getTitle(href) {
			return ipcRenderer.invoke('getLinkTitle', href)
		},
		saveFromUrl(href, contextPath) {
			return ipcRenderer.invoke('saveFromUrl', href, contextPath)
		},
		getUrlData(url) {
			return ipcRenderer.invoke('getUrlData', url)
		},
	},
	query: {
		resultsForQuery(queryString) {
			return ipcRenderer.invoke('query', 'results', queryString)
		},
		parseQuery(queryString) {
			return ipcRenderer.invoke('query', 'parse', queryString)
		}
	},
	settings: {
		patch(patch: any) {
			ipcRenderer.send('patchGlobalSettings', patch)
		}
	},
	theme: {
		getCodeThemes() {
			return ipcRenderer.invoke('getCodeThemes')
		},
		getCodeTheme(name) {
			return ipcRenderer.invoke('getCodeTheme', name)
		},
	},
	documentation: {
		open(name) {
			ipcRenderer.invoke('documentation', 'open', name)
		},
		get(name) {
			return ipcRenderer.invoke('documentation', 'get', name)
		},
		getChangelogs() {
			return ipcRenderer.invoke('documentation', 'getChangelogs')
		},
		getRecentChanges() {
			return ipcRenderer.invoke('documentation', 'getRecentChanges')
		}
	},
	dictionary: {
		getAllWords() {
			return ipcRenderer.invoke('dictionary', 'getAllWords')
		},
		removeWord(word) {
			return ipcRenderer.invoke('dictionary', 'remove', word)
		}
	},
	update: {
		onChecking(handler) {
			on('checking-for-update', handler)
		},
		onAvailable(handler) {
			on('update-available', handler)
		},
		onNotAvailable(handler) {
			on('update-not-available', handler)
		},
		onProgress(handler) {
			on('update-progress', handler)
		},
		onReady(handler) {
			on('update-ready', handler)
		},
		onError(handler) {
			on('update-error', handler)
		},
		checkForUpdate() {
			ipcRenderer.send('update', 'check')
		},
		update() {
			ipcRenderer.send('update', 'now')
		}
	}
}

contextBridge.exposeInMainWorld('api', bridge)

// ---------------------------------------------------------------------------
// Pre-bridge safety net: start buffering Codex messages immediately so nothing
// is lost before the application code registers its first onMessage handler.
// ---------------------------------------------------------------------------

(window as any).__pendingCodexMsgs = []

ipcRenderer.on(CodexChannel.Message, (_e, msg: CodexMessage) => {
  // If at least one real listener is already attached ipcRenderer will have
  // delivered the same event to it as well. We only need to buffer when the
  // queue is still non-null (meaning no listeners yet).
  if ((window as any).__pendingCodexMsgs) {
    (window as any).__pendingCodexMsgs.push(msg)
  }
})