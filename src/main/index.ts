import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, safeStorage, Tray, type MenuItemConstructorOptions, type OpenDialogOptions } from 'electron'
import { statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadCollectorScript } from './collector/channel'
import { ConnectionManager } from './connection/manager'
import type { CostAlertState } from '@shared/events'
import type { CronAlert } from './cron/watcher'
import type { GatewayAlert } from './gateway/watcher'
import { registerIpc } from './ipc'
import { NotificationCenter } from './notify/center'
import { autoUpdater } from 'electron-updater'
import { UpdateService } from './update/service'
import { createLogger } from './log'
import { WEB_PREFERENCES, hardenWebContents, type AppTarget } from './security'
import { MissionSession } from './session'
import { passwordStoreSwitch, secretServiceRunning } from './store/passwordStore'
import { SecretStore } from './store/secretStore'
import { SettingsStore } from './store/settingsStore'
import { ptyProblem, spawnPty } from './terminal/pty'

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

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const inFront = (): boolean => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()

function focusWindow(): void {
  if (!win || win.isDestroyed()) return
  win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

function cronNotice(alert: CronAlert): Parameters<NotificationCenter['push']>[0] {
  const reason = (alert.lastError ?? alert.lastStatus ?? 'failed').replace(/\s+/g, ' ').slice(0, 120)
  return { kind: 'cron', title: `Cron failed: ${alert.name}`, body: `${alert.profile} · ${reason}`, target: { kind: 'cron', profile: alert.profile, jobId: alert.jobId } }
}

function costNotice(s: CostAlertState): Parameters<NotificationCenter['push']>[0] {
  return { kind: 'cost', title: `Daily cost over $${s.threshold.toFixed(2)}`, body: `$${(s.total ?? 0).toFixed(2)} so far today`, target: { kind: 'usage' } }
}

function gatewayNotice(alert: GatewayAlert): Parameters<NotificationCenter['push']>[0] {
  const title = alert.kind === 'gateway' ? `Gateway stopped: ${alert.profile}` : `Platform problem: ${alert.profile} · ${alert.platform ?? ''}`
  return { kind: 'gateway', title, body: alert.detail, target: { kind: 'logs', tab: 'gateway' } }
}

let tray: Tray | null = null
let quitting = false

/** F-SHELL-3: with "keep running in the tray", closing the window hides it; the tray menu shows it again or quits. */
function applyTray(on: boolean): void {
  if (on && !tray) {
    const icon = nativeImage.createFromPath(join(projectRoot, 'assets', 'brand', 'icon-1024.png'))
    tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }))
    tray.setToolTip('Hermes Agent Mission Control')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Mission Control', click: () => focusWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit() } }
    ]))
    tray.on('click', () => focusWindow())
  } else if (!on && tray) {
    tray.destroy()
    tray = null
  }
}

/** Why automatic updates cannot work in this copy of the app, or null when they can. */
function updatesUnsupported(): string | null {
  if (process.env['MC_NO_UPDATE']) return 'Updates are turned off for this run.'
  if (!app.isPackaged) return 'Updates work in the installed app only.'
  if (process.platform === 'linux' && !process.env['APPIMAGE']) return 'This copy came from a package (.deb); update it with your package manager, or use the AppImage for automatic updates.'
  return null
}

function applyLoginItem(on: boolean): void {
  // Linux has no login items in Electron (the switch is hidden there); a development run would register electron.exe
  if (!app.isPackaged || (process.platform !== 'win32' && process.platform !== 'darwin')) return
  // the window opens in front at sign-in; "Start minimized" decides otherwise, as for any start
  app.setLoginItemSettings({ openAtLogin: on, args: [] })
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
  // started minimized (a setting): the window waits in the taskbar or the tray
  const hidden = store.getSetting('app.startMinimized')
  w.once('ready-to-show', () => {
    if (!hidden) w.show()
    else if (!store.getSetting('app.tray')) w.minimize()
  })
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
  w.on('close', (e) => {
    if (store.getSetting('app.tray') && tray && !quitting) {
      e.preventDefault()
      w.hide()
      return
    }
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
  app.on('second-instance', () => focusWindow())

  // Must be set before ready, when Chromium picks the safeStorage backend.
  const passwordStore = passwordStoreSwitch({
    platform: process.platform,
    env: process.env,
    hasSwitch: app.commandLine.hasSwitch('password-store'),
    secretServiceRunning
  })
  if (passwordStore) app.commandLine.appendSwitch('password-store', passwordStore)

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
    if (passwordStore) log(`password-store ${passwordStore}: desktop unknown to Chromium, Secret Service running`)
    const store = new SettingsStore(join(userData, 'app.db'))
    const secrets = new SecretStore(safeStorage)
    const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) })
    const send = (channel: string, payload: unknown): void => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }
    const center = new NotificationCenter({
      settings: () => ({
        desktop: store.getSetting('notify.desktop'),
        kinds: store.getSetting('notify.kinds'),
        preview: store.getSetting('notify.preview'),
        sound: store.getSetting('notify.sound'),
        replySound: store.getSetting('notify.replySound'),
        quiet: store.getSetting('notify.quiet')
      }),
      inFront,
      send,
      focus: focusWindow,
      makeOs: Notification.isSupported() ? (o) => new Notification(o) : null
    })
    const session = new MissionSession({
      manager,
      store,
      secrets,
      collectorScript: loadCollectorScript(collectorPath()),
      send,
      log,
      notify: (a) => center.push(cronNotice(a)),
      notifyCost: (s) => center.push(costNotice(s)),
      notifyGateway: (a) => center.push(gatewayNotice(a)),
      pickFiles: async () => {
        const r = await (win ? dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }) : dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }))
        return r.canceled ? [] : r.filePaths
      },
      // F-CONN-7: the key file is picked here; the E2E names its throwaway key instead of driving a native dialog
      openKeyDialog: async () => {
        const forced = process.env['MC_E2E_KEY_FILE']
        if (forced) return forced
        const ssh = join(homedir(), '.ssh')
        const opts: OpenDialogOptions = { title: 'Choose the private key', properties: ['openFile', 'showHiddenFiles'], ...(isDir(ssh) ? { defaultPath: ssh } : {}) }
        const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
        return r.canceled ? null : (r.filePaths[0] ?? null)
      },
      terminalLocal: {
        spawn: spawnPty,
        platform: process.platform,
        env: process.env,
        home: homedir(),
        exists: (f) => {
          try {
            return statSync(f).isFile()
          } catch {
            return false
          }
        },
        // the host key the user trusted in this app, for the system ssh of server tabs (~/.ssh is left alone)
        writeKnownHosts: (text) => {
          const file = join(app.getPath('userData'), 'ssh_known_hosts')
          writeFileSync(file, text, { mode: 0o600 })
          return file
        },
        problem: ptyProblem
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
    const why = updatesUnsupported()
    if (!why) autoUpdater.logger = null
    const updates = new UpdateService({
      updater: why ? null : autoUpdater,
      ...(why ? { unsupportedWhy: why } : {}),
      current: app.getVersion(),
      enabled: () => store.getSetting('app.autoUpdate'),
      send,
      log
    })
    updates.start()
    registerIpc({
      updates,
      session,
      store,
      getWindow: () => win,
      target,
      center,
      onSetting: (key, value) => {
        if (key === 'app.tray') applyTray(value === true)
        if (key === 'app.launchAtLogin') applyLoginItem(value === true)
      }
    })
    applyTray(store.getSetting('app.tray'))
    // keeps the login item in step with the setting (an older version registered it with --hidden)
    if (store.getSetting('app.launchAtLogin')) applyLoginItem(true)
    Menu.setApplicationMenu(buildMenu())
    win = createWindow(store)
    win.on('closed', () => (win = null))
    app.on('before-quit', () => {
      quitting = true
      session.termKillAll()
      void session.disconnect()
    })
  }

  app.on('window-all-closed', () => app.quit())
}
