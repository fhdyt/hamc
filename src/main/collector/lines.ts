export class LineSplitter {
  private buf = ''

  constructor(private readonly maxLine = 1_048_576) {}

  push(chunk: string): string[] {
    this.buf += chunk
    const parts = this.buf.split('\n')
    this.buf = parts.pop() ?? ''
    if (this.buf.length > this.maxLine) this.buf = ''
    return parts.map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0)
  }
}
