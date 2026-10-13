import { deflateRawSync } from 'node:zlib'

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

/** A plain zip (deflate, UTF-8 names, no zip64: the backup is capped far below 4 GiB). */
export function makeZip(entries: readonly { name: string; data: Buffer; mtime?: Date }[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const packed = deflateRawSync(e.data)
    const crc = crc32(e.data)
    const { time, date } = dosTime(e.mtime ?? new Date())
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6)
    head.writeUInt16LE(8, 8)
    head.writeUInt16LE(time, 10)
    head.writeUInt16LE(date, 12)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(packed.length, 18)
    head.writeUInt32LE(e.data.length, 22)
    head.writeUInt16LE(name.length, 26)
    head.writeUInt16LE(0, 28)
    local.push(head, name, packed)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt16LE(time, 12)
    dir.writeUInt16LE(date, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(packed.length, 20)
    dir.writeUInt32LE(e.data.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)
    offset += head.length + name.length + packed.length
  }
  const dirBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dirBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, dirBuf, end])
}
