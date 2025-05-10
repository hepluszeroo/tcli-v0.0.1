import { BrowserWindow, Menu, MenuItemConstructorOptions, shell, app } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { mode } from './environment'
import { isMac } from '../common/isMac'
import { disableRendererActions } from './menus'
import { checkForUpdatesThrottled } from './updates'
import WindowHandle from './WindowHandle'
import { contentsMap, workspaceMap } from './workspaces'
import { ipcMain } from 'electron'
import { cleanMenuTemplate } from '../common/menus'
import { getSettings } from './settings'
import { addShutDownTask } from './shutdown'

// Flag to detect when running from package-app-smoke-test.js
const isPackagedSmoke = !!process.env.PACKAGED_APP_SMOKE_TEST;

let defaultLanguages = null

export function createWindow(assignedWorkspace?: string) {
	// Create the browser window.

	// Determine the correct preload path based on execution context
	let preloadPath: string;

	if (app.isPackaged || isPackagedSmoke) {
		// Packaged app or smoke-test run launched from the dist folder
		preloadPath = path.join(app.getAppPath(), 'bundle', 'preload.js');
		console.log(`[WINDOWS] Using packaged app preload path: ${preloadPath}`);
	} else {
		// Dev / e2e stub launch
		preloadPath = path.join(__dirname, 'preload.js');
		console.log(`[WINDOWS] Using development preload path: ${preloadPath}`);
	}

	// Verify the preload file exists and log diagnostic info
	if (!fs.existsSync(preloadPath)) {
		console.error(`[WINDOWS] CRITICAL ERROR: Preload missing at ${preloadPath}`);
		console.error(`[WINDOWS] App path: ${app.getAppPath()}`);
		console.error(`[WINDOWS] __dirname: ${__dirname}`);
		console.error(`[WINDOWS] cwd: ${process.cwd()}`);
		console.error(`[WINDOWS] isPackaged: ${app.isPackaged}`);
		console.error(`[WINDOWS] isPackagedSmoke: ${isPackagedSmoke}`);

		// Fallback to alternative paths (legacy support)
		const fallbackPaths = [
			path.join(__dirname, 'bundle', 'preload.js'),
			path.join(app.getAppPath(), 'preload.js'),
			path.join(app.getAppPath(), 'bundle', 'preload.js'),
			path.resolve(process.cwd(), 'preload.js'),
			path.resolve(process.cwd(), 'bundle', 'preload.js')
		];

		for (const fallbackPath of fallbackPaths) {
			console.log(`[WINDOWS] Trying fallback path: ${fallbackPath}`);
			if (fs.existsSync(fallbackPath)) {
				preloadPath = fallbackPath;
				console.log(`[WINDOWS] Found preload at fallback path: ${preloadPath}`);
				break;
			}
		}

		// If we still don't have a valid path, log additional diagnostic info
		if (!fs.existsSync(preloadPath)) {
			// Check if bundle directory exists
			const bundleDir = path.join(app.getAppPath(), 'bundle');
			const bundleDirExists = fs.existsSync(bundleDir);
			console.error(`[WINDOWS] Bundle directory ${bundleDir} exists: ${bundleDirExists}`);

			if (bundleDirExists) {
				try {
					const bundleContents = fs.readdirSync(bundleDir);
					console.error(`[WINDOWS] Bundle directory contents: ${bundleContents.join(', ')}`);
				} catch (err) {
					console.error(`[WINDOWS] Error reading bundle directory: ${err.message}`);
				}
			}
		}
	} else {
		console.log(`[WINDOWS] Verified preload path exists: ${preloadPath}`);
	}

	let windowOptions: Electron.BrowserWindowConstructorOptions = {
		width: 2000,
		height: 1200,
		minWidth: 100,
		minHeight: 100,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,  // Ensure contextIsolation is enabled
			nodeIntegration: false   // Ensure nodeIntegration is disabled for security
		},
		show: false
	}

	if (os.platform() === 'linux') {
		// To work around an icon issue, apply the icon to the window directly
		windowOptions.icon = path.join(__dirname, '../../static/tangent_256.png')
	}

	// Customize different framing settings`
	if (isMac) {
		windowOptions.titleBarStyle = 'hiddenInset'
	}
	else {
		windowOptions.frame = false
	}

	const newWindow = new BrowserWindow(windowOptions)

	newWindow.once('ready-to-show', () => {
		newWindow.show()
	})

	let handle = new WindowHandle(newWindow)
	contentsMap.set(newWindow.webContents, handle)
	handle.assignedWorkspacePath = assignedWorkspace || null

	newWindow.on('focus', () => {
		disableRendererActions()
		newWindow.webContents.send('getAllMenus')

		checkForUpdatesThrottled()
	})

	newWindow.webContents.on('context-menu', (event, input) => {

		const template: MenuItemConstructorOptions[] = []

		const customizations = handle.contextMenuCustomizations
		delete handle.contextMenuCustomizations

		if (customizations?.top) {
			template.push(...customizations.top)
		}

		if (input.misspelledWord) {

			template.push({ type: 'separator' })

			if (input.dictionarySuggestions.length === 0) {
				template.push({
					label: 'No Guesses Found',
					enabled: false
				})
			}

			for (const suggestion of input.dictionarySuggestions) {
				template.push({
					label: `Replace with "${suggestion}"`,
					click: () => newWindow.webContents.replaceMisspelling(suggestion)
				})
			}

			template.push(
				{
					label: `Add "${input.misspelledWord}" to dictionary`,
					click: () => newWindow.webContents.session.addWordToSpellCheckerDictionary(input.misspelledWord)
				},
				{ type: 'separator' }
			)
		}

		if (input.isEditable) {

			template.push(
				{ type: 'separator' },
				{
					label: 'Copy',
					accelerator: 'CommandOrControl+C',
					registerAccelerator: false,
					enabled: input.editFlags.canCopy,
					click: () => {
						newWindow.webContents.copy()
					}
				},
				{
					label: 'Cut',
					accelerator: 'CommandOrControl+X',
					registerAccelerator: false,
					enabled: input.editFlags.canCut,
					click: () => {
						newWindow.webContents.cut()
					}
				},
				{
					label: 'Paste',
					accelerator: 'CommandOrControl+V',
					registerAccelerator: false,
					enabled: input.editFlags.canPaste,
					click: () => {
						newWindow.webContents.paste()
					}
				},
				{ type: 'separator' }
			)
		}

		if (customizations?.bottom) {
			template.push(...customizations.bottom)
		}

		const menu = Menu.buildFromTemplate(cleanMenuTemplate(template))
		menu.popup()
	})

	// Handle links by default
	newWindow.webContents.setWindowOpenHandler(details => {
		shell.openExternal(details.url)
		return { action: 'deny' }
	})

	// and load the index.html of the app.
	newWindow.loadFile(path.join(__dirname, '../../static/index.html'))

	if (mode === 'development' && !process.env.INTEGRATION_TEST) {
		// Open the DevTools.
		newWindow.webContents.openDevTools()
	}

	if (!defaultLanguages) {
		defaultLanguages = newWindow.webContents.session.getSpellCheckerLanguages()
	}

	const settings = getSettings()
	const settingUnsubs = [
		settings.spellCheckLanguages.subscribe(langs => {
			const newLangs = [
				...defaultLanguages,
				...langs
			]
			newWindow.webContents.session.setSpellCheckerLanguages(newLangs)
		}),
		settings.enableSpellCheck.subscribe(enabled => {
			newWindow.webContents.session.setSpellCheckerEnabled(enabled)
		})
	]

	newWindow.on('close', () => {
		settingUnsubs.forEach(i => i())

		let handle = contentsMap.get(newWindow.webContents)
		if (handle) {
			// Save out the window state
			addShutDownTask(handle.close())

			if (isMac || contentsMap.size > 1) {
				// On windows/linux do not flush the last window.
				// That will happen on 'windows-all-closed'
				contentsMap.delete(newWindow.webContents)
			}
		}
	})

	return newWindow
};

export function getOrCreateWindowForWorkspace(workspacePath: string): BrowserWindow {
	for (const handle of contentsMap.values()) {
		if (handle.assignedWorkspacePath === workspacePath) {
			return handle.window
		}
	}

	return createWindow(workspacePath)
}

ipcMain.handle('createWindow', (event) => {
	createWindow()
})
