import { app, BrowserWindow, dialog, Menu, Notification, safeStorage, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '@shared/channels'
import { loadCollectorScript } from './collector/channel'
import { ConnectionManager } from './connection/manager'
import type { CronAlert } from './cron/watcher'
import { registerIpc } from './ipc'
import { createLogger } from './log'
import { WEB_PREFERENCES, hardenWebContents, type AppTarget } from './security'
import { MissionSession } from './session'
import { SecretStore } from './store/secretStore'
import { SettingsStore } from './store/settingsStore'

if (process.env['MC_USER_DATA']) app.setPath('userData', process.env['MC_USER_DATA'])

const devUrl = process.env['ELECTRON_RENDERER_URL']
const indexPath = join(__dirname, '../renderer/index.html')
const target: AppTarget = devUrl ? { devUrl } : { indexFileUrl: pathToFileURL(indexPath).href }

let win: BrowserWindow | null = null

// Unpackaged, __dirname is <project>/out/main whether started by electron-vite or `electron out/main/index.js`.
const projectRoot = join(__dirname, '..', '..')

function collectorPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'mc_collector.py') : join(projectRoot, 'collector', 'mc_collector.py')
}

const liveNotifications = new Set<Notification>()

/** Failed cron runs only notify when the window is not in front of the user. */
function showCronAlert(alert: CronAlert): void {
  const w = win
  const inFront = !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()
  if (inFront || !Notification.isSupported()) return
  const reason = (alert.lastError ?? alert.lastStatus ?? 'failed').replace(/\s+/g, ' ').slice(0, 120)
  const n = new Notification({ title: `Cron failed: ${alert.name}`, body: `${alert.profile} · ${reason}` })
  liveNotifications.add(n)
  n.on('close', () => liveNotifications.delete(n))
  n.on('click', () => {
    liveNotifications.delete(n)
    if (!win || win.isDestroyed()) return
    win.show()
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send(IPC.evOpenCron, { profile: alert.profile, jobId: alert.jobId })
  })
  n.show()
}

function buildMenu(): Menu {
  const edit: MenuItemConstructorOptions = { role: 'editMenu' }
  const template: MenuItemConstructorOptions[] = process.platform === 'darwin' ? [{ role: 'appMenu' }, edit] : [edit]
  return Menu.buildFromTemplate(template)
}

function createWindow(store: SettingsStore): BrowserWindow {
  const b = store.getSetting('window.bounds')
  const w = new BrowserWindow({
    width: b?.width ?? 1280,
    height: b?.height ?? 800,
    ...(b?.x !== undefined && b?.y !== undefined ? { x: b.x, y: b.y } : {}),
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: '#282A36',
    title: 'Hermes Agent Mission Control',
    icon: join(projectRoot, 'assets', 'brand', 'icon-1024.png'),
    webPreferences: { ...WEB_PREFERENCES, preload: join(__dirname, '../preload/index.js') }
  })
  hardenWebContents(w.webContents, target)
  w.setMenuBarVisibility(false)
  w.once('ready-to-show', () => w.show())
  w.webContents.on('did-finish-load', () => w.webContents.setZoomFactor(store.getSetting('ui.zoom')))
  w.on('close', () => {
    if (!w.isMaximized() && !w.isMinimized()) {
      const r = w.getBounds()
      store.setSetting('window.bounds', { x: r.x, y: r.y, width: r.width, height: r.height })
    }
  })
  if (devUrl) void w.loadURL(devUrl)
  else void w.loadFile(indexPath)
  return w
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    try {
      start()
    } catch (e) {
      dialog.showErrorBox('Hermes Agent Mission Control could not start', e instanceof Error ? e.message : String(e))
      app.quit()
    }
  })

  function start(): void {
    const userData = app.getPath('userData')
    const log = createLogger(userData)
    const store = new SettingsStore(join(userData, 'app.db'))
    const secrets = new SecretStore(safeStorage)
    const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) })
    const session = new MissionSession({
      manager,
      store,
      secrets,
      collectorScript: loadCollectorScript(collectorPath()),
      send: (channel, payload) => {
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
      },
      log,
      notify: showCronAlert
    })
    registerIpc({ session, store, getWindow: () => win, target })
    Menu.setApplicationMenu(buildMenu())
    win = createWindow(store)
    win.on('closed', () => (win = null))
    app.on('before-quit', () => void session.disconnect())
  }

  app.on('window-all-closed', () => app.quit())
}
