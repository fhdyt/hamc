import type { AuthMethod } from '@shared/ipc'

export interface FormValues {
  host: string
  port: string
  username: string
  auth: AuthMethod
  password: string
  /** The key file picked in the dialog, or the saved one. */
  keyPath: string | null
  keyEncrypted: boolean
  passphrase: string
  /** A secret of this method is saved (password, or the passphrase of the saved key). */
  hasSavedSecret: boolean
  sameTarget: boolean
  /** Same target and the same key file as the saved connection. */
  sameKey: boolean
}

export type FormCheck =
  | { ok: true; port: number }
  | { ok: false; field: 'host' | 'port' | 'username' | 'password' | 'key' | 'passphrase'; message: string }

export function validateConnectForm(v: FormValues): FormCheck {
  const host = v.host.trim()
  if (!host) return { ok: false, field: 'host', message: 'Enter the host or public IP.' }
  if (/\s/.test(host) || host.includes('://') || host.includes('/')) {
    return { ok: false, field: 'host', message: 'Enter only the host name or IP address.' }
  }
  if (!/^\d+$/.test(v.port.trim())) return { ok: false, field: 'port', message: 'Port must be a number from 1 to 65535.' }
  const port = Number(v.port.trim())
  if (port < 1 || port > 65535) return { ok: false, field: 'port', message: 'Port must be a number from 1 to 65535.' }
  if (!v.username.trim()) return { ok: false, field: 'username', message: 'Enter the user that runs Hermes.' }
  if (v.auth === 'password') {
    if (!v.password && !(v.hasSavedSecret && v.sameTarget)) return { ok: false, field: 'password', message: 'Enter the password.' }
    return { ok: true, port }
  }
  if (!v.keyPath) return { ok: false, field: 'key', message: 'Choose the key file.' }
  if (v.keyEncrypted && !v.passphrase && !(v.hasSavedSecret && v.sameKey)) {
    return { ok: false, field: 'passphrase', message: 'Enter the passphrase of this key.' }
  }
  return { ok: true, port }
}
