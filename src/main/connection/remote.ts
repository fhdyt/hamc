import type { ExecResult, Execer } from './manager'

const FIND_HERMES =
  'command -v hermes || for p in "$HOME/.local/bin/hermes" "$HOME/.hermes/hermes-agent/venv/bin/hermes"; do if [ -x "$p" ]; then printf %s "$p"; exit 0; fi; done; exit 1'

const COUNT_PROFILES =
  'n=0; for d in "$1"/profiles/*/; do for m in config.yaml .env SOUL.md profile.yaml state.db; do if [ -e "$d$m" ]; then n=$((n+1)); break; fi; done; done; printf %s "$n"'

const STATE_DB_PY = `import sqlite3, sys, pathlib
p = pathlib.Path(sys.argv[1]) / 'state.db'
if not p.is_file():
    print('missing'); sys.exit(0)
try:
    c = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True, timeout=1)
    v = None
    try:
        r = c.execute('select version from schema_version').fetchone()
        v = r[0] if r else None
    except Exception:
        pass
    if v is None:
        v = (c.execute('pragma user_version').fetchone() or [None])[0]
    print('ok', v)
except Exception as e:
    print('err', type(e).__name__)
`

export const resolveHomeCmd = (): string[] => ['sh', '-c', 'printf %s "${HERMES_HOME:-$HOME/.hermes}"']
export const homeExistsCmd = (home: string): string[] => ['test', '-d', home]
export const findHermesCmd = (): string[] => ['sh', '-c', FIND_HERMES]
export const shebangCmd = (hermes: string): string[] => ['head', '-n', '1', hermes]
export const versionCmd = (hermes: string): string[] => [hermes, '--version']
export const profileCountCmd = (home: string): string[] => ['sh', '-c', COUNT_PROFILES, 'sh', home]
export const stateDbCmd = (python: string, home: string): string[] => [python, '-c', STATE_DB_PY, home]
export const pythonVersionCmd = (python: string): string[] => [python, '--version']
export const probeCmd = (hermes: string, sub: string[]): string[] => [hermes, ...sub, '--help']
export const modelCmd = (hermes: string, profile: string): string[] =>
  profile === 'default' ? [hermes, 'config', 'get', 'model', '--json'] : [hermes, '-p', profile, 'config', 'get', 'model', '--json']
export const collectorCmd = (python: string, home: string): string[] => [python, '-u', '-', home]

export async function runSafe(conn: Execer, argv: string[], timeoutMs = 15_000): Promise<ExecResult> {
  try {
    return await conn.exec(argv, { timeoutMs })
  } catch (e) {
    return { code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }
  }
}
