import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../../src/main/log'

describe('createLogger', () => {
  it('appends timestamped lines to app.log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-log-'))
    try {
      const log = createLogger(dir)
      log('hello')
      log('world')
      const text = readFileSync(join(dir, 'logs', 'app.log'), 'utf8').trim().split('\n')
      expect(text).toHaveLength(2)
      expect(text[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z hello$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never throws even if the directory cannot be written', () => {
    const log = createLogger('Z:\\definitely\\missing\\\0bad')
    expect(() => log('x')).not.toThrow()
  })
})
