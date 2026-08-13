/** Electron main process for the no-CLI DSHCode desktop application. */

import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  createQuitCoordinator,
  desktopApplicationUrl,
  desktopWebArguments,
  ensureMainModuleArgument,
  navigationDisposition,
  type QuitCoordinator,
} from './lifecycle.ts'

const PRODUCT_NAME = 'DSHCode'
const APP_ID = 'com.whitelonng.dshcode'
let mainWindow: BrowserWindow | undefined
let applicationUrl: string | undefined
let quitCoordinator: QuitCoordinator | undefined
let nativeExitAllowed = false

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

async function createMainWindow(rawUrl: string): Promise<void> {
  const origin = new URL(rawUrl).origin
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  })
  mainWindow = window
  installRendererPolicy(window, origin)
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(PRODUCT_NAME)
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
  await createMainWindow(applicationUrl)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.on('before-quit', (event) => {
    if (nativeExitAllowed) return
    event.preventDefault()
    requestQuit(0)
  })
  app.on('window-all-closed', () => {
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
