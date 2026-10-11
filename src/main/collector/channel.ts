import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type { ClientChannel } from 'ssh2'
import { collectorCmd } from '../connection/remote'
import { LineSplitter } from './lines'
import { EventRouter } from './router'

export function loadCollectorScript(path: string): string {
  return readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
}

export interface CollectorOptions {
  python: string
  home: string
  script: string
  log?: (msg: string) => void
}

interface Streamer {
  openStream(argv: readonly string[], stdin: string): Promise<ClientChannel>
}

export class CollectorChannel extends EventEmitter {
  private ch: ClientChannel | null = null

  constructor(
    private readonly conn: Streamer,
    private readonly opts: CollectorOptions
  ) {
    super()
  }

  async start(): Promise<void> {
    const log = this.opts.log ?? ((): void => {})
    const ch = await this.conn.openStream(collectorCmd(this.opts.python, this.opts.home), this.opts.script)
    this.ch = ch
    const splitter = new LineSplitter()
    const router = new EventRouter(log)
    router.on('event', (e) => this.emit('event', e))
    ch.setEncoding('utf8')
    ch.stderr.setEncoding('utf8')
    ch.on('data', (d: string) => splitter.push(d).forEach((l) => router.handleLine(l)))
    ch.stderr.on('data', (d: string) => log(`collector stderr: ${d.trim().slice(0, 200)}`))
    ch.on('close', () => {
      if (this.ch === ch) this.ch = null
      this.emit('closed')
    })
  }

  stop(): void {
    const ch = this.ch
    this.ch = null
    ch?.close()
  }
}
