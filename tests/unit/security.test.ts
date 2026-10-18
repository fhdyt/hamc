import { describe, expect, it } from 'vitest'
import { buildCsp } from '@shared/csp'
import { WEB_PREFERENCES, isAllowedNavigation, isTrustedSender } from '../../src/main/security'

describe('web preferences', () => {
  it('enforces the Electron hardening flags', () => {
    expect(WEB_PREFERENCES.contextIsolation).toBe(true)
    expect(WEB_PREFERENCES.sandbox).toBe(true)
    expect(WEB_PREFERENCES.nodeIntegration).toBe(false)
    expect(WEB_PREFERENCES.webSecurity).toBe(true)
    expect(WEB_PREFERENCES.allowRunningInsecureContent).toBe(false)
  })
})

describe('buildCsp', () => {
  it('is strict in production', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('ws:')
  })

  it('relaxes only script and connect for the dev server', () => {
    const csp = buildCsp(true)
    expect(csp).toContain("'unsafe-eval'")
    expect(csp).toContain('ws://localhost:*')
  })
})

describe('isAllowedNavigation', () => {
  const dev = { devUrl: 'http://localhost:5173/' }
  const prod = { indexFileUrl: 'file:///C:/app/out/renderer/index.html' }

  it('allows only the dev origin in dev', () => {
    expect(isAllowedNavigation('http://localhost:5173/#/x', dev)).toBe(true)
    expect(isAllowedNavigation('https://evil.example/', dev)).toBe(false)
    expect(isAllowedNavigation('http://localhost:9999/', dev)).toBe(false)
  })

  it('allows only the index file in production', () => {
    expect(isAllowedNavigation('file:///C:/app/out/renderer/index.html#top', prod)).toBe(true)
    expect(isAllowedNavigation('file:///C:/Windows/system.ini', prod)).toBe(false)
    expect(isAllowedNavigation('https://example.com', prod)).toBe(false)
    expect(isAllowedNavigation('not a url', prod)).toBe(false)
  })

  it('rejects everything when no target is known', () => {
    expect(isAllowedNavigation('http://localhost:5173/', {})).toBe(false)
  })
})

describe('isTrustedSender', () => {
  const prod = { indexFileUrl: 'file:///C:/app/out/renderer/index.html' }
  it('accepts the app page and rejects others', () => {
    expect(isTrustedSender('file:///C:/app/out/renderer/index.html', prod)).toBe(true)
    expect(isTrustedSender('https://example.com', prod)).toBe(false)
    expect(isTrustedSender(undefined, prod)).toBe(false)
  })

  it('accepts the page of an app installed under an 8.3 short folder name', () => {
    // Node's pathToFileURL writes `~` as %7E, Chromium keeps `~` (C:\Users\RUNNER~1\… on the CI runner)
    const short = { indexFileUrl: 'file:///C:/Users/RUNNER%7E1/AppData/Local/app/resources/app.asar/out/renderer/index.html' }
    expect(isTrustedSender('file:///C:/Users/RUNNER~1/AppData/Local/app/resources/app.asar/out/renderer/index.html', short)).toBe(true)
    expect(isTrustedSender('file:///C:/Users/RUNNER%7e1/AppData/Local/app/resources/app.asar/out/renderer/index.html', short)).toBe(true)
    expect(isTrustedSender('file:///C:/Users/RUNNER~2/AppData/Local/app/resources/app.asar/out/renderer/index.html', short)).toBe(false)
    // only escapes of unreserved characters are equal to the character: an escaped slash is still not a slash
    expect(isTrustedSender('file:///C:/app/out%2Frenderer/index.html', prod)).toBe(false)
  })
})
