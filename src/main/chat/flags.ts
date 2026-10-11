export interface ChatFlags {
  oneshot: boolean
  queryFile: boolean
  format: boolean
  streamJson: boolean
  resume: boolean
  source: boolean
  quiet: boolean
  /** True when `hermes chat --help` could not be read and the flags are taken from the documentation. */
  assumed: boolean
}

export const ASSUMED_FLAGS: ChatFlags = { oneshot: true, queryFile: true, format: true, streamJson: true, resume: true, source: true, quiet: true, assumed: true }

/** Which options `hermes chat` offers, read from its help text. */
export function parseChatHelp(text: string): ChatFlags {
  const has = (re: RegExp): boolean => re.test(text)
  const format = has(/--format\b/)
  return {
    oneshot: has(/--oneshot\b/),
    queryFile: has(/--query-file\b/),
    format,
    streamJson: format && has(/stream-json/),
    resume: has(/--resume\b/),
    source: has(/--source\b/),
    quiet: has(/--quiet\b|(^|[\s[,])-Q\b/m),
    assumed: false
  }
}

/** The structured mode needs all three of these; anything less falls back to plain text output. */
export const canStream = (f: ChatFlags): boolean => f.oneshot && f.queryFile && f.streamJson

export function limitedReason(f: ChatFlags): string {
  const missing = [!f.oneshot && '--oneshot', !f.queryFile && '--query-file', !f.streamJson && '--format stream-json'].filter(Boolean)
  return `This Hermes version has no ${missing.join(', ')}, so replies arrive as plain text without tool steps, and the conversation cannot be resumed.`
}
