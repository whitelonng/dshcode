/**
 * Sandboxed preload bridge: the only Electron surface the renderer sees.
 * Exposes the desktop frame facts (from launch arguments) and the window-menu
 * popup RPC. Sandboxed preloads cannot load ESM, so tsdown bundles this entry
 * as CommonJS (`lib/preload.cjs`); the payload parsing stays in lifecycle.ts
 * where the node test suite covers it without loading Electron.
 */
import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_RESTART_CHANNEL,
  DESKTOP_SHOW_MENU_CHANNEL,
  desktopBridgePayload,
} from './lifecycle.ts'

const payload = desktopBridgePayload(process.argv, process.platform)

contextBridge.exposeInMainWorld('dshDesktop', {
  ...payload,
  showMenu: () => {
    void ipcRenderer.invoke(DESKTOP_SHOW_MENU_CHANNEL)
  },
  restart: () => {
    void ipcRenderer.invoke(DESKTOP_RESTART_CHANNEL)
  },
})
