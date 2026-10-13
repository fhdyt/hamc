import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, safeStorage, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '@shared/channels'
import { loadCollectorScript } from './collector/channel'
import { ConnectionManager } from './connection/manager'
import type { CostAlertState } from '@shared/events'
import type { CronAlert } from './cron/watcher'
import type { GatewayAlert } from './gateway/watcher'
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

/** The daily cost passed the threshold; like a failed cron run it only rings when the window is not in front. */
function showCostAlert(s: CostAlertState): void {
  const w = win
  const inFront = !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()
  if (inFront || !Notification.isSupported()) return
  const n = new Notification({ title: `Daily cost over $${s.threshold.toFixed(2)}`, body: `$${(s.total ?? 0).toFixed(2)} so far today` })
  liveNotifications.add(n)
  n.on('close', () => liveNotifications.delete(n))
  n.on('click', () => {
    liveNotifications.delete(n)
    if (!win || win.isDestroyed()) return
    win.show()
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send(IPC.evOpenUsage, null)
  })
  n.show()
}

/** A gateway stopped or a platform failed; like a failed cron run it only rings when the window is not in front. */
function showGatewayAlert(alert: GatewayAlert): void {
  const w = win
  const inFront = !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()
  if (inFront || !Notification.isSupported()) return
  const title = alert.kind === 'gateway' ? `Gateway stopped: ${alert.profile}` : `Platform problem: ${alert.profile} \u00b7 ${alert.platform ?? ''}`
  const n = new Notification({ title, body: alert.detail })
  liveNotifications.add(n)
  n.on('close', () => liveNotifications.delete(n))
  n.on('click', () => {
    liveNotifications.delete(n)
    if (!win || win.isDestroyed()) return
    win.show()
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send(IPC.evOpenLogs, 'gateway')
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
    // The title bar takes the colours of the UI; the renderer draws the drag strip (TitleBar). macOS keeps its own.
    ...(process.platform === 'darwin' ? {} : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#21222C', symbolColor: '#F8F8F2', height: 32 } }),
    title: 'Hermes Agent Mission Control',
    icon: join(projectRoot, 'assets', 'brand', 'icon-1024.png'),
    webPreferences: { ...WEB_PREFERENCES, preload: join(__dirname, '../preload/index.js') }
  })
  hardenWebContents(w.webContents, target)
  w.setMenuBarVisibility(false)
  w.once('ready-to-show', () => w.show())
  w.webContents.on('did-finish-load', () => w.webContents.setZoomFactor(store.getSetting('ui.zoom')))
  // The renderer sets a beforeunload guard while Agent settings hold unsaved edits (F-CFG-18); this asks instead of closing silently.
  w.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(w, {
      type: 'question',
      buttons: ['Keep editing', 'Discard changes and close'],
      defaultId: 0,
      cancelId: 0,
      title: 'Unsaved changes',
      message: 'You have unsaved changes in Agent settings.',
      detail: 'Edits are only kept in the window until you press Save.'
    })
    if (choice === 1) e.preventDefault()
  })
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
      notify: showCronAlert,
      notifyCost: showCostAlert,
      notifyGateway: showGatewayAlert,
      pickFiles: async () => {
        const r = await (win ? dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }) : dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }))
        return r.canceled ? [] : r.filePaths
      },
      makeThumb: (path) => {
        try {
          const img = nativeImage.createFromPath(path)
          if (img.isEmpty()) return undefined
          const { width } = img.getSize()
          return (width > 160 ? img.resize({ width: 160 }) : img).toDataURL()
        } catch {
          return undefined
        }
      }
    })
    registerIpc({ session, store, getWindow: () => win, target })
    Menu.setApplicationMenu(buildMenu())
    win = createWindow(store)
    win.on('closed', () => (win = null))
    app.on('before-quit', () => void session.disconnect())
  }

  app.on('window-all-closed', () => app.quit())
}
