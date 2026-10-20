import { describe, expect, it } from 'vitest'
import { busyWork, serverAddress, serverName } from '../../src/renderer/lib/servers'

describe('server names (F-CONN-14)', () => {
  it('names a server by its label, else user@host', () => {
    expect(serverName({ label: 'prod', username: 'root', host: 'h' })).toBe('prod')
    expect(serverName({ label: '', username: 'root', host: 'h' })).toBe('root@h')
  })

  it('writes the address with the port', () => {
    expect(serverAddress({ username: 'root', host: '10.0.0.1', port: 2222 })).toBe('root@10.0.0.1:2222')
  })
})

describe('busyWork', () => {
  it('is empty when nothing would stop', () => {
    expect(busyWork({ chats: 0, rooms: 0, uploads: 0, drafts: 0 })).toEqual([])
  })

  it('lists what a switch would stop', () => {
    expect(busyWork({ chats: 2, rooms: 1, uploads: 1, drafts: 1 })).toEqual([
      '2 chat replies in progress',
      '1 room conversation running',
      '1 upload in progress',
      'unsaved changes in Settings → Agents'
    ])
    expect(busyWork({ chats: 1, rooms: 2, uploads: 3, drafts: 0 })).toEqual(['1 chat reply in progress', '2 room conversations running', '3 uploads in progress'])
  })
})
