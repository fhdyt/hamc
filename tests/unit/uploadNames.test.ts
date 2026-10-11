import { describe, expect, it } from 'vitest'
import { dayStamp, isImage, isUploadedFile, mimeOf, resolveUploadDir, sanitizeName, uniqueName } from '../../src/main/uploads/names'

describe('sanitizeName', () => {
  it('keeps ordinary names', () => {
    expect(sanitizeName('report.pdf')).toBe('report.pdf')
    expect(sanitizeName('Laporan Harian 2026-10-11 (final).xlsx')).toBe('Laporan Harian 2026-10-11 (final).xlsx')
  })

  it('drops any directory part, whichever separator was used', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeName('..\\..\\Windows\\win.ini')).toBe('win.ini')
    expect(sanitizeName('/abs/path/file.txt')).toBe('file.txt')
    expect(sanitizeName('a/b/')).toBe('file')
  })

  it('does not let a name start with a dot or a dash, and removes control characters', () => {
    expect(sanitizeName('.env')).toBe('_env')
    expect(sanitizeName('..')).toBe('file')
    expect(sanitizeName('-rf')).toBe('_rf')
    expect(sanitizeName('a\u0000b\nc\u001f.txt')).toBe('a_b_c_.txt')
    expect(sanitizeName('x<y>:"|?*.txt')).toBe('x_y______.txt')
    expect(sanitizeName('   ')).toBe('file')
    expect(sanitizeName('')).toBe('file')
  })

  it('limits the length and keeps the extension', () => {
    const n = sanitizeName('a'.repeat(300) + '.pdf')
    expect(n.length).toBe(120)
    expect(n.endsWith('.pdf')).toBe(true)
    expect(sanitizeName('b'.repeat(300)).length).toBe(120)
  })
})

describe('uniqueName', () => {
  it('returns the name when it is free, else adds -1, -2 before the extension', async () => {
    const taken = new Set(['report.pdf', 'report-1.pdf', 'notes', 'notes-1'])
    const free = (c: string): Promise<boolean> => Promise.resolve(taken.has(c))
    expect(await uniqueName('fresh.txt', free)).toBe('fresh.txt')
    expect(await uniqueName('report.pdf', free)).toBe('report-2.pdf')
    expect(await uniqueName('notes', free)).toBe('notes-2')
  })

  it('gives up after 99 tries', async () => {
    expect(await uniqueName('a.txt', () => Promise.resolve(true))).toBeNull()
  })
})

describe('dayStamp, mime and the upload folder', () => {
  it('formats the date as YYYYMMDD', () => {
    expect(dayStamp(new Date(2026, 9, 5))).toBe('20261005')
    expect(dayStamp(new Date(2026, 11, 31))).toBe('20261231')
  })

  it('guesses a type from the extension', () => {
    expect(mimeOf('Report.PDF')).toBe('application/pdf')
    expect(mimeOf('photo.jpeg')).toBe('image/jpeg')
    expect(mimeOf('noext')).toBe('application/octet-stream')
    expect(mimeOf('archive.unknown')).toBe('application/octet-stream')
    expect(isImage('image/png')).toBe(true)
    expect(isImage('image/svg+xml')).toBe(false)
    expect(isImage('application/pdf')).toBe(false)
  })

  it('resolves ~ against the server home and refuses odd settings', () => {
    expect(resolveUploadDir('~/hermes-uploads', '/home/u')).toBe('/home/u/hermes-uploads')
    expect(resolveUploadDir('~/hermes-uploads/', '/home/u/')).toBe('/home/u/hermes-uploads')
    expect(resolveUploadDir('/srv/uploads', '/home/u')).toBe('/srv/uploads')
    expect(resolveUploadDir('~', '/home/u')).toBe('/home/u')
    for (const bad of ['', '   ', 'relative/dir', '~/../etc', '/a/../b', 'x\u0000y']) expect(resolveUploadDir(bad, '/home/u')).toBe('/home/u/hermes-uploads')
  })

  it('only treats <base>/<agent>/<date>/<name> as an uploaded file', () => {
    const base = '/home/u/hermes-uploads'
    expect(isUploadedFile(`${base}/atlas/20261010/report.pdf`, base)).toBe(true)
    for (const bad of [
      `${base}/atlas/20261010`,
      `${base}/atlas/20261010/a/b.txt`,
      `${base}/atlas/notadate/x.txt`,
      `${base}/../.hermes/state.db`,
      `${base}/atlas/20261010/../../../etc/passwd`,
      '/home/u/.hermes/.env',
      `${base}/atlas/20261010/`,
      `${base}x/atlas/20261010/f.txt`
    ])
      expect(isUploadedFile(bad, base)).toBe(false)
  })
})
