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

/**
 * A URL path in the form RFC 3986 calls equivalent: an escape of an unreserved character becomes the character, other
 * escapes get upper-case hex. Node's pathToFileURL writes `~` as %7E while Chromium keeps `~`, so without this an app
 * installed under an 8.3 folder name (C:\Users\RUNNER~1\…) would reject its own page.
 */
function canonicalPath(p: string): string {
  return p.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => {
    const c = String.fromCharCode(parseInt(hex, 16))
    return /[A-Za-z0-9._~-]/.test(c) ? c : `%${hex.toUpperCase()}`
  })
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
    return u.protocol === 'file:' && canonicalPath(u.pathname) === canonicalPath(index.pathname)
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
