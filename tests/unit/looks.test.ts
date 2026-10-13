import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PHOTO_RE, cleanLookName, squareCrop } from '@shared/looks'
import { normalizePhoto, type ImageLike } from '../../src/main/looks'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { withNames } from '../../src/renderer/lib/roster'
import type { AgentInfo } from '@shared/events'

describe('cleanLookName', () => {
  it('trims, collapses spaces, drops control characters and caps at 24', () => {
    expect(cleanLookName('  Scout\u0007  the\t\nscout ')).toBe('Scout the scout')
    expect(cleanLookName('   ')).toBeNull()
    expect(cleanLookName('x'.repeat(40))).toHaveLength(24)
  })
})

describe('squareCrop', () => {
  it('takes the centred square, zoomed and moved', () => {
    expect(squareCrop(200, 100)).toEqual({ sx: 50, sy: 0, side: 100 })
    expect(squareCrop(100, 300)).toEqual({ sx: 0, sy: 100, side: 100 })
    expect(squareCrop(200, 200, 2)).toEqual({ sx: 50, sy: 50, side: 100 })
    expect(squareCrop(200, 100, 1, -1)).toEqual({ sx: 0, sy: 0, side: 100 })
    expect(squareCrop(200, 100, 1, 5)).toEqual({ sx: 100, sy: 0, side: 100 })
  })
})

function fakeImage(w: number, h: number, calls: string[]): ImageLike {
  return {
    isEmpty: () => w === 0,
    getSize: () => ({ width: w, height: h }),
    crop: (r) => {
      calls.push(`crop ${r.x},${r.y},${r.width}`)
      return fakeImage(r.width, r.height, calls)
    },
    resize: (o) => {
      calls.push(`resize ${o.width}x${o.height}`)
      return fakeImage(o.width, o.height, calls)
    },
    toPNG: () => Buffer.from(`png ${w}x${h}`)
  }
}

describe('normalizePhoto', () => {
  const url = 'data:image/jpeg;base64,AAAA'
  it('decodes, squares and re-encodes as a 96×96 PNG', () => {
    const calls: string[] = []
    const out = normalizePhoto(url, () => fakeImage(300, 200, calls))
    expect(calls).toEqual(['crop 50,0,200', 'resize 96x96'])
    expect(out).toBe(`data:image/png;base64,${Buffer.from('png 96x96').toString('base64')}`)
    expect(PHOTO_RE.test(out!)).toBe(true)
  })
  it('refuses what is not a small picture', () => {
    const ok = () => fakeImage(100, 100, [])
    expect(normalizePhoto('data:image/svg+xml;base64,AAAA', ok)).toBeNull()
    expect(normalizePhoto('https://x.org/a.png', ok)).toBeNull()
    expect(normalizePhoto(`data:image/png;base64,${'A'.repeat(300_000)}`, ok)).toBeNull()
    expect(normalizePhoto(url, () => fakeImage(0, 0, []))).toBeNull()
    expect(normalizePhoto(url, () => fakeImage(4, 4, []))).toBeNull()
    expect(
      normalizePhoto(url, () => {
        throw new Error('bad')
      })
    ).toBeNull()
  })
})

describe('agent_looks in app.db', () => {
  let store: SettingsStore
  beforeEach(() => {
    store = new SettingsStore(':memory:')
  })
  afterEach(() => store.close())
  const conn = { name: 'prod', host: '10.0.0.1', port: 22, username: 'root', remember: false }

  it('keeps a name and a photo per connection and profile, and drops the row when both are gone', () => {
    const id = store.upsertConnection(conn)
    expect(store.getLooks(id)).toEqual({})
    expect(store.setLook(id, 'scout', { name: 'Ranger' })).toEqual({ name: 'Ranger', photo: null })
    store.setLook(id, 'scout', { photo: 'data:image/png;base64,AAAA' })
    expect(store.getLooks(id)).toEqual({ scout: { name: 'Ranger', photo: 'data:image/png;base64,AAAA' } })
    expect(store.getLooks(id + 1)).toEqual({})
    store.setLook(id, 'scout', { name: null })
    store.setLook(id, 'scout', { photo: null })
    expect(store.getLooks(id)).toEqual({})
  })

  it('forgets the looks with the connection', () => {
    const id = store.upsertConnection(conn)
    store.setLook(id, 'default', { name: 'Boss' })
    store.forgetConnection()
    expect(store.getLooks(id)).toEqual({})
  })
})

describe('withNames', () => {
  it('shows the local name and keeps the rest', () => {
    const a = { profile: 'scout', displayName: 'Scout', status: 'idle' } as AgentInfo
    const b = { profile: 'atlas', displayName: 'atlas', status: 'idle' } as AgentInfo
    expect(withNames([a, b], { scout: 'Ranger' }).map((x) => x.displayName)).toEqual(['Ranger', 'atlas'])
  })
})
