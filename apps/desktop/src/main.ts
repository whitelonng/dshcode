/** Electron main process for the no-CLI DSHCode desktop application. */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, session, shell, Tray } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE_PATCH_FILENAME, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  fallbackModulesDir,
  pruneBootFailures,
  readPluginState,
  readSafeMode,
  setPluginRowEnabled,
  setSafeMode,
  writeBootFailure,
} from '@deepseek-ai/dsh-host-plugin-installer'
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
  DESKTOP_FRAME_ARG,
  DESKTOP_RESTART_CHANNEL,
  DESKTOP_NOTIFICATION_CHANNEL,
  DESKTOP_NOTIFICATION_CLICK_CHANNEL,
  DESKTOP_SHOW_MENU_CHANNEL,
  ensureMainModuleArgument,
  navigationDisposition,
  trayIconFile,
  windowCloseDisposition,
  type QuitCoordinator,
} from './lifecycle.ts'
import { readBootMarker, writeBootMarker } from './boot-marker.ts'
import {
  attributeLoadFailure,
  clearResolvedFailures,
  CONSECUTIVE_FAILURE_THRESHOLD,
  DESKTOP_BOOT_TIMEOUT_MS,
  failureMessage,
  recordBootFailures,
  recoveryDecision,
  withBootTimeout,
} from './recovery.ts'

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
 * Used by the tray, the second-instance lock, and macOS dock activation: a
 * hidden window restores, a closed one relaunches against the still-running
 * application URL.
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
  // product name and application version on every platform (the UI shows the
  // version); only Windows additionally receives the custom-frame argument —
  // a native-frame platform must never see `--dsh-frame=custom`, or the
  // renderer would draw the Windows chrome over the system title bar.
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
      additionalArguments: customFrame
        ? [DESKTOP_FRAME_ARG, ...desktopLaunchArguments(PRODUCT_NAME, app.getVersion())]
        : desktopLaunchArguments(PRODUCT_NAME, app.getVersion()),
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

/**
 * Record a late unhandled plugin-init rejection before the fail-loud exit
 * (the tree is suspect, so the default hard exit stays). The failure is
 * attributed to an installed plugin when its name appears in the rejection;
 * next launch the plugin list shows the badge, and a startup that dies
 * before `ok` still triggers the recovery dialog through the boot marker.
 */
function reportLateRejection(error: unknown): void {
  const home = resolveDshHome()
  const { message, stack } = failureMessage(error)
  try {
    const [pluginId] = attributeLoadFailure(error, readPluginState(home).plugins)
    if (pluginId === undefined) return
    void writeBootFailure(home, {
      pluginId,
      kind: 'late-rejection',
      message,
      stack,
      installPath: join(fallbackModulesDir(home), pluginId),
      at: new Date().toISOString(),
    }).catch((writeError: unknown) => {
      console.error(`${PRODUCT_NAME}: failed to record late plugin failure`, writeError)
    })
  } catch (attributeError) {
    console.error(`${PRODUCT_NAME}: failed to attribute late plugin failure`, attributeError)
  }
}

/**
 * Handle a failed desktop boot: record the attributable failures, then show
 * the recovery dialog offering to disable the blamed plugins and restart,
 * to start in safe mode (skip the user patch layers), or to exit. Every path
 * terminates the process — the caller must not continue startup after this.
 */
async function handleStartupFailure(
  error: unknown,
  context: {
    home: string
    profilePatchPath: string
    lastOkAt: string | undefined
    bootAttempts: number
    safeMode: boolean
  },
): Promise<void> {
  const { home, profilePatchPath, lastOkAt, bootAttempts, safeMode } = context
  const decision = recoveryDecision({ error, installed: readPluginState(home).plugins, lastOkAt })

  // Safe mode failing still means a broken bundle layer or overlay, not a
  // user plugin; retry or exit, without disabling anything.
  if (safeMode) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: `${PRODUCT_NAME} 启动失败`,
      message: '安全模式下仍无法启动',
      detail: `${decision.message}\n\n安全模式已跳过用户插件配置，问题可能来自内置组件或安装本身。请重试，或退出后检查安装。`,
      buttons: ['重启应用', '退出'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response === 0) {
      app.relaunch()
      requestQuit(0)
      return
    }
    requestQuit(1)
    return
  }

  const attributable = decision.kind === 'attributable'
  if (attributable) await recordBootFailures(home, decision)
  const crashLoopHint = bootAttempts >= CONSECUTIVE_FAILURE_THRESHOLD
    ? '\n\n连续多次启动失败，建议使用安全模式。'
    : ''
  const detail = attributable
    ? `以下插件未能正常加载：${decision.pluginIds.join('、')}\n\n${decision.message}${crashLoopHint}`
    : `无法确定是哪个插件导致启动失败。${crashLoopHint}\n\n${decision.message}`
  const safeModeIndex = attributable ? 1 : 0
  const buttons = attributable ? ['继续（禁用插件并重启）', '安全模式启动', '退出'] : ['安全模式启动', '退出']
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: `${PRODUCT_NAME} 启动失败`,
    message: '插件启动失败',
    detail,
    buttons,
    defaultId: crashLoopHint !== '' ? safeModeIndex : 0,
    cancelId: buttons.length - 1,
    noLink: true,
  })
  if (attributable && response === 0) {
    for (const pluginId of decision.pluginIds) {
      try {
        await setPluginRowEnabled(profilePatchPath, pluginId, false)
      } catch (disableError) {
        console.error(`${PRODUCT_NAME}: failed to disable ${pluginId}`, disableError)
      }
    }
    app.relaunch()
    requestQuit(0)
    return
  }
  if (response === safeModeIndex) {
    await setSafeMode(home, true)
    app.relaunch()
    requestQuit(0)
    return
  }
  requestQuit(1)
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

  // Deny every renderer permission except the sanitized clipboard write the
  // Web UI's copy buttons need: `navigator.clipboard.writeText` rejects when
  // `clipboard-sanitized-write` is refused, which would make every copy
  // control a silent no-op. Everything else (notifications, media, location)
  // stays denied.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'clipboard-sanitized-write'
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })

  const home = resolveDshHome()
  const profilePatchPath = join(resolveProfileDir('web', home), PROFILE_PATCH_FILENAME)
  // Boot lifecycle marker: a previous `started` without a following `ok`
  // means the last launch died during startup, and the attempt counter
  // drives the safe-mode default of the recovery dialog. Diagnostics must
  // never block startup, so every marker failure degrades to first-run.
  const previousMarker = readBootMarker(home)
  const marker = await writeBootMarker(home, 'started').catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: failed to write boot marker`, error)
    return undefined
  })
  await pruneBootFailures(home).catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: failed to sweep boot failures`, error)
  })
  const safeMode = readSafeMode(home)

  let running: Awaited<ReturnType<typeof runProfile>>
  try {
    running = await withBootTimeout(runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: 'web',
      patchFiles: [],
      args: desktopWebArguments(),
      watchUserPatches: false,
      skipUserPatches: safeMode,
      failLoud: reportLateRejection,
    }), DESKTOP_BOOT_TIMEOUT_MS)
  } catch (error) {
    await handleStartupFailure(error, {
      home,
      profilePatchPath,
      lastOkAt: previousMarker?.state === 'ok' ? previousMarker.at : undefined,
      bootAttempts: marker?.bootAttempts ?? 1,
      safeMode,
    })
    return
  }
  await writeBootMarker(home, 'ok').catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: failed to write boot marker`, error)
  })
  await clearResolvedFailures(home, profilePatchPath).catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: failed to clear resolved boot failures`, error)
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
  // Native OS notifications: the renderer's notification sink detects this
  // bridge and routes every notification through the main process. A click
  // shows the window (close-to-tray may have hidden it) and echoes the
  // request id back so the renderer opens the notification's target session.
  ipcMain.handle(DESKTOP_NOTIFICATION_CHANNEL, (event, request: { id: string; title: string; body?: string }) => {
    if (applicationUrl === undefined) return
    if (!desktopIpcSenderIsApplication(event.senderFrame?.url, new URL(applicationUrl).origin)) return
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: request.title,
      ...(request.body === undefined ? {} : { body: request.body }),
    })
    notification.on('click', () => {
      showMainWindow()
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DESKTOP_NOTIFICATION_CLICK_CHANNEL, request.id)
      }
    })
    notification.show()
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
    // The close-to-tray policy leaves the window existing but hidden, and
    // unlike an application-level hide macOS does not restore it on dock
    // activation. showMainWindow() restores a hidden window or recreates a
    // closed one against the still-running profile.
    showMainWindow()
  })

  void app.whenReady().then(startDesktop).catch((error: unknown) => {
    dialog.showErrorBox(`${PRODUCT_NAME} could not start`, error instanceof Error ? error.message : String(error))
    requestQuit(1)
  })
}
