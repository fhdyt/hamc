import { EventEmitter } from 'node:events'
import { parseEventLine } from '@shared/events'

export class EventRouter extends EventEmitter {
  constructor(private readonly log: (msg: string) => void) {
    super()
  }

  handleLine(line: string): void {
    const r = parseEventLine(line)
    if (r.ok) this.emit('event', r.event)
    else this.log(`invalid collector line (${r.error}): ${line.slice(0, 120)}`)
  }
}
