/** The highest message id received per profile, so a restarted collector can continue instead of replaying history. */
export class FeedCursors {
  private ids = new Map<string, number>()

  apply(cursors: Readonly<Record<string, number>>): void {
    for (const [profile, id] of Object.entries(cursors)) {
      const prev = this.ids.get(profile)
      if (prev === undefined || id > prev) this.ids.set(profile, id)
    }
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.ids)
  }

  /** JSON for the collector's --cursors argument, or null when nothing has been received yet. */
  toArg(): string | null {
    return this.ids.size === 0 ? null : JSON.stringify(this.snapshot())
  }

  clear(): void {
    this.ids.clear()
  }
}
