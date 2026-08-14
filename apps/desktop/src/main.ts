/** Electron main process for the no-CLI DSHCode desktop application. */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  buildTrayMenu,
  buildWindowMenu,
  createQuitCoordinator,
  desktopApplicationUrl,
  desktopIpcSenderIsApplication,
  desktopLaunchArguments,
  desktopWebArguments,
  DESKTOP_RESTART_CHANNEL,
  DESKTOP_SHOW_MENU_CHANNEL,
  ensureMainModuleArgument,
  navigationDisposition,
  trayIconFile,
  windowCloseDisposition,
  type QuitCoordinator,
} from './lifecycle.ts'

const PRODUCT_NAME = 'DSHCode'
const APP_ID = 'com.whitelonng.dshcode'
/** Absolute directory of the bundled main module (Contents/Resources/app/lib). */
const mainDir = fileURLToPath(new URL('.', import.meta.url))
let mainWindow: BrowserWindow | undefined
let applicationUrl: string | undefined
let quitCoordinator: QuitCoordinator | undefined
let nativeExitAllowed = false
let quitArmed = false
let tray: Tray | undefined

function reportExternalOpenFailure(error: unknown): void {
  console.error(`${PRODUCT_NAME}: failed to open external link`, error)
}

function openExternal(rawUrl: string): void {
  void shell.openExternal(rawUrl).catch(reportExternalOpenFailure)
}

function installRendererPolicy(window: BrowserWindow, origin: string): void {
  window.webContents.on('will-navigate', (event, rawUrl) => {
    const disposition = navigationDisposition(rawUrl, origin)
    if (disposition === 'application') return
    event.preventDefault()
    if (disposition === 'external') openExternal(rawUrl)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (navigationDisposition(url, origin) === 'external') openExternal(url)
    return { action: 'deny' }
  })
}

/**
 * Show and focus the main window, recreating it when it no longer exists.
 * Used by the tray and the second-instance lock: a hidden window restores,
 * a closed one relaunches against the still-running application URL.
 */
function showMainWindow(): void {
  if (mainWindow !== undefined) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  if (applicationUrl === undefined) return
  void createMainWindow(applicationUrl).catch((error: unknown) => {
    dialog.showErrorBox(`${PRODUCT_NAME} could not open`, error instanceof Error ? error.message : String(error))
    requestQuit(1)
  })
}

/**
 * Install the system tray: the colored app logo on every platform, with the
 * primary click showing the main window and the secondary click popping the
 * context menu. Creation is guarded because some Linux desktops provide no
 * tray host; the window close-to-tray policy then degrades to a real close.
 * The macOS image carries explicit 1x/2x representations so the logo renders
 * crisply on Retina displays.
 */
function installTray(): void {
  if (tray !== undefined) return
  try {
    const assetsDir = join(mainDir, '..', 'assets')
    const image = process.platform === 'darwin'
      ? (() => {
        const logo = nativeImage.createEmpty()
        logo.addRepresentation({ scaleFactor: 1, buffer: readFileSync(join(assetsDir, 'tray16.png')) })
        logo.addRepresentation({ scaleFactor: 2, buffer: readFileSync(join(assetsDir, 'tray.png')) })
        return logo
      })()
      : nativeImage.createFromPath(join(assetsDir, trayIconFile(process.platform)))
    const trayIcon = new Tray(image)
    trayIcon.setToolTip(PRODUCT_NAME)
    const menu = Menu.buildFromTemplate(buildTrayMenu({
      show: showMainWindow,
      quit: () => {
        quitArmed = true
        requestQuit(0)
      },
    }))
    if (process.platform === 'darwin') {
      // On macOS a set context menu swallows the left-click event, so the
      // primary click shows the window and the secondary click pops the menu.
      trayIcon.on('click', showMainWindow)
      trayIcon.on('right-click', () => { trayIcon.popUpContextMenu(menu) })
    } else {
      trayIcon.setContextMenu(menu)
      trayIcon.on('click', showMainWindow)
    }
    tray = trayIcon
  } catch (error) {
    console.error(`${PRODUCT_NAME}: system tray unavailable`, error)
  }
}

async function createMainWindow(rawUrl: string): Promise<void> {
  const origin = new URL(rawUrl).origin
  // Windows runs a custom single-row title bar: the renderer draws the
  // product name and menu button in a drag region, while titleBarOverlay
  // keeps native minimize/maximize/close buttons on the same row. The
  // preload bridge (CJS; sandboxed preloads cannot load ESM) carries the
  // frame mode and product name to the renderer.
  const customFrame = process.platform === 'win32'
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#ffffff',
    ...(customFrame
      ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: {
          // Matches the shell's light-theme base surface; a theme-driven
          // update is a follow-up.
          color: '#ffffff',
          symbolColor: '#0f1115',
          height: 38,
        },
      }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      preload: join(mainDir, 'preload.cjs'),
      additionalArguments: customFrame ? desktopLaunchArguments(PRODUCT_NAME) : [],
    },
  })
  mainWindow = window
  installRendererPolicy(window, origin)
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(PRODUCT_NAME)
  })
  // Closing the window hides to the tray unless a real quit owns teardown;
  // without a tray host (some Linux desktops) the close really closes.
  window.on('close', (event) => {
    if (tray !== undefined && windowCloseDisposition(quitArmed) === 'hide') {
      event.preventDefault()
      window.hide()
    }
  })
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  await window.loadURL(rawUrl)
}

function finishNativeExit(code: number): void {
  nativeExitAllowed = true
  app.exit(code)
}

function requestQuit(code: number): void {
  const coordinator = quitCoordinator
  if (coordinator === undefined) {
    finishNativeExit(code)
    return
  }
  void coordinator.request(code).catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: shutdown failed`, error)
    finishNativeExit(1)
  })
}

async function startDesktop(): Promise<void> {
  app.setName(PRODUCT_NAME)
  app.setAppUserModelId(APP_ID)
  ensureMainModuleArgument(process.argv, fileURLToPath(import.meta.url))
  process.chdir(app.getPath('home'))

  // Windows and Linux would otherwise render the default File/Edit/View
  // menu bar as a full-width row below the title bar; the tray context menu
  // and the embedded Web UI own application commands. macOS keeps its system
  // menu bar (app menu, standard edit roles, Cmd+Q).
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  installTray()

  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  const running = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [],
    args: desktopWebArguments(),
    watchUserPatches: false,
  })
  quitCoordinator = createQuitCoordinator(running.shutdown, finishNativeExit)
  applicationUrl = desktopApplicationUrl(running.ctx.webServer.host, running.ctx.webServer.port)
  // The title-bar menu button pops a native window menu; only a page of the
  // application origin may invoke it.
  ipcMain.handle(DESKTOP_SHOW_MENU_CHANNEL, (event) => {
    if (mainWindow === undefined || applicationUrl === undefined) return
    if (!desktopIpcSenderIsApplication(event.senderFrame?.url, new URL(applicationUrl).origin)) return
    Menu.buildFromTemplate(buildWindowMenu({
      hide: () => { mainWindow?.hide() },
      restart: () => {
        quitArmed = true
        app.relaunch()
        requestQuit(0)
      },
      quit: () => {
        quitArmed = true
        requestQuit(0)
      },
    })).popup({ window: mainWindow })
  })
  // The plugin-management surface restarts the whole application in place so
  // profile and patch changes take effect (packaged Electron cannot hot-apply
  // host plugins). relaunch() is queued before the Harness shutdown so the
  // process restarts regardless of how teardown settles.
  ipcMain.handle(DESKTOP_RESTART_CHANNEL, (event) => {
    if (applicationUrl === undefined) return
    if (!desktopIpcSenderIsApplication(event.senderFrame?.url, new URL(applicationUrl).origin)) return
    quitArmed = true
    app.relaunch()
    requestQuit(0)
  })
  await createMainWindow(applicationUrl)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // A second launch restores a tray-hidden window (or recreates a closed
    // one) instead of starting another Harness tree.
    showMainWindow()
  })
  app.on('before-quit', (event) => {
    if (nativeExitAllowed) return
    event.preventDefault()
    quitArmed = true
    requestQuit(0)
  })
  app.on('window-all-closed', () => {
    // The close-to-tray policy hides the window, so this only fires while a
    // real quit closes the window; the quit path already owns teardown.
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (mainWindow !== undefined || applicationUrl === undefined) return
    void createMainWindow(applicationUrl).catch((error: unknown) => {
      dialog.showErrorBox(`${PRODUCT_NAME} could not open`, error instanceof Error ? error.message : String(error))
      requestQuit(1)
    })
  })

  void app.whenReady().then(startDesktop).catch((error: unknown) => {
    dialog.showErrorBox(`${PRODUCT_NAME} could not start`, error instanceof Error ? error.message : String(error))
    requestQuit(1)
  })
}
