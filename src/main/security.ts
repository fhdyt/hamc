import type { WebContents, WebPreferences } from 'electron'

export const WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false
} satisfies WebPreferences

export interface AppTarget {
  devUrl?: string
  indexFileUrl?: string
}

export function isAllowedNavigation(url: string, target: AppTarget): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (target.devUrl) return u.origin === new URL(target.devUrl).origin
  if (target.indexFileUrl) {
    const index = new URL(target.indexFileUrl)
    return u.protocol === 'file:' && u.pathname === index.pathname
  }
  return false
}

export function isTrustedSender(senderUrl: string | undefined, target: AppTarget): boolean {
  return senderUrl !== undefined && isAllowedNavigation(senderUrl, target)
}

export function hardenWebContents(wc: WebContents, target: AppTarget): void {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  const block = (e: { preventDefault(): void }, url: string): void => {
    if (!isAllowedNavigation(url, target)) e.preventDefault()
  }
  wc.on('will-navigate', block)
  wc.on('will-redirect', block)
  wc.on('will-attach-webview', (e) => e.preventDefault())
  // The only permission: writing text to the clipboard (the Copy button on code blocks). Reading it stays blocked.
  wc.session.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
  wc.session.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
}
