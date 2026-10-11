import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

describe('toolchain', () => {
  it('runs under the Electron runtime so native modules share one ABI', () => {
    expect(process.versions.electron).toBeTruthy()
  })

  it('opens an in-memory sqlite database', () => {
    const db = new Database(':memory:')
    expect(db.prepare('select 1 as x').get()).toEqual({ x: 1 })
    db.close()
  })
})
