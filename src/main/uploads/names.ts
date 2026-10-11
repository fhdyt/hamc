const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  py: 'text/x-python',
  js: 'text/javascript',
  ts: 'text/typescript',
  log: 'text/plain'
}

export function mimeOf(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return MIME[ext] ?? 'application/octet-stream'
}

export const isImage = (mime: string): boolean => /^image\/(png|jpeg|gif|webp|bmp)$/.test(mime)

const MAX_NAME = 120

/**
 * A safe file name for the server: no directory part, no control characters, nothing that starts with a dot or a dash,
 * and no longer than 120 characters (the extension is kept).
 */
export function sanitizeName(raw: string): string {
  let name = raw.replace(/\\/g, '/').split('/').pop() ?? ''
  name = name.replace(/[\u0000-\u001f\u007f]/g, '_').replace(/[<>:"|?*]/g, '_').trim()
  name = name.replace(/^[.\-\s]+/, '_')
  if (name === '' || name === '_') name = 'file'
  if (name.length > MAX_NAME) {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : ''
    name = name.slice(0, MAX_NAME - ext.length) + ext
  }
  return name
}

/** `report.pdf` taken -> `report-1.pdf`, `report-2.pdf`, ... until `exists` says no. */
export async function uniqueName(name: string, exists: (candidate: string) => Promise<boolean>): Promise<string | null> {
  if (!(await exists(name))) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; i <= 99; i++) {
    const c = `${stem}-${i}${ext}`
    if (!(await exists(c))) return c
  }
  return null
}

export function dayStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

export const DEFAULT_UPLOAD_DIR = '~/hermes-uploads'

/** The upload folder as an absolute path on the server; anything odd falls back to the default. */
export function resolveUploadDir(setting: string, home: string): string {
  const h = home.replace(/\/+$/, '')
  const pick = (s: string): string | null => {
    const t = s.trim()
    if (!t || t.includes('\0') || t.length > 300 || t.split('/').includes('..')) return null
    if (t === '~') return h
    if (t.startsWith('~/')) return `${h}/${t.slice(2)}`.replace(/\/+$/, '')
    return t.startsWith('/') ? t.replace(/\/+$/, '') || '/' : null
  }
  return pick(setting) ?? pick(DEFAULT_UPLOAD_DIR)!
}

/**
 * Whether `path` is one of the files the uploads wrote: exactly <base>/<agent>/<date>/<name>, with plain names.
 * This is the only kind of path the app will delete.
 */
export function isUploadedFile(path: string, base: string): boolean {
  const b = base.replace(/\/+$/, '')
  if (!path.startsWith(b + '/')) return false
  const parts = path.slice(b.length + 1).split('/')
  return parts.length === 3 && parts.every((p) => p !== '' && p !== '.' && p !== '..' && !p.includes('\0')) && /^\d{8}$/.test(parts[1]!)
}
