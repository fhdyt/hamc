export interface FormValues {
  host: string
  port: string
  username: string
  password: string
  hasSavedPassword: boolean
  sameTarget: boolean
}

export type FormCheck =
  | { ok: true; port: number }
  | { ok: false; field: 'host' | 'port' | 'username' | 'password'; message: string }

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
  if (!v.password && !(v.hasSavedPassword && v.sameTarget)) {
    return { ok: false, field: 'password', message: 'Enter the password.' }
  }
  return { ok: true, port }
}
