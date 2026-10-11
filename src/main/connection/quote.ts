export function shQuote(arg: string): string {
  if (arg.includes('\0')) throw new Error('argument contains a NUL byte')
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

export function buildCommand(argv: readonly string[]): string {
  if (argv.length === 0) throw new Error('empty argv')
  return argv.map(shQuote).join(' ')
}
