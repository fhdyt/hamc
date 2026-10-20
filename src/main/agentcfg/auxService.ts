import { z } from 'zod'
import { PROFILE_RE, profileDir } from '@shared/agentCfg'
import { AUX_KEYS, buildAuxSave, type AuxReadResult, type AuxSaveRequest, type AuxSaveResult, type AuxSlots } from '@shared/auxModels'
import type { Execer, ExecResult } from '../connection/manager'

/**
 * v2 auxiliary models, read side. Run as `python -c <script> <config.yaml path>` with Hermes's own Python: PyYAML is a
 * Hermes dependency. It prints one JSON line with provider, model, base_url and whether an api_key is set for each slot,
 * never a key, and it writes nothing. Hermes itself is not imported (its config loader may migrate and save the file).
 * The marker MC_AUX_READ lets the test server recognise it. ASCII only.
 */
export const AUX_READ_PY = `# MC_AUX_READ
import json, os, sys
TASKS = ${JSON.stringify(AUX_KEYS)}
def done(o):
    sys.stdout.write(json.dumps(o) + chr(10))
    sys.exit(0)
try:
    import yaml
except Exception:
    done({'ok': False, 'error': 'no-yaml'})
path = sys.argv[1]
cfg = {}
if os.path.isfile(path):
    try:
        with open(path, 'rb') as f:
            cfg = yaml.safe_load(f.read(1048576)) or {}
    except Exception as e:
        done({'ok': False, 'error': 'failed', 'detail': type(e).__name__})
aux = cfg.get('auxiliary') if isinstance(cfg, dict) else None
aux = aux if isinstance(aux, dict) else {}
out = {}
for t in TASKS:
    s = aux.get(t)
    s = s if isinstance(s, dict) else {}
    vals = {}
    for k in ('provider', 'model', 'base_url'):
        v = s.get(k)
        vals[k] = v[:200] if isinstance(v, str) else ''
    out[t] = {'provider': vals['provider'] or 'auto', 'model': vals['model'], 'baseUrl': vals['base_url'], 'hasKey': bool(s.get('api_key'))}
done({'ok': True, 'slots': out})
`

const Slot = z.object({ provider: z.string().max(200), model: z.string().max(200), baseUrl: z.string().max(200), hasKey: z.boolean() })
const ReadOut = z.union([
  z.object({ ok: z.literal(true), slots: z.record(z.string(), Slot) }),
  z.object({ ok: z.literal(false), error: z.enum(['no-yaml', 'failed']), detail: z.string().optional() })
])

export interface AuxDeps {
  conn: Execer
  hermes: () => { path: string; python: string; home: string } | null
  isConnected: () => boolean
  log?: (m: string) => void
}

const text = (r: ExecResult): string => (r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`).slice(0, 600)

async function run(conn: Execer, argv: string[]): Promise<ExecResult> {
  try {
    return await conn.exec(argv, { timeoutMs: 20_000 })
  } catch (e) {
    return { code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }
  }
}

/** Reads the 18 slots with the script above; saves only through `hermes [-p P] config set auxiliary.<task>.<field>`. */
export class AuxService {
  constructor(private readonly d: AuxDeps) {}

  async read(profile: string): Promise<AuxReadResult> {
    if (!PROFILE_RE.test(profile)) return { ok: false, error: 'bad-profile' }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    const r = await run(this.d.conn, [h.python, '-c', AUX_READ_PY, `${profileDir(h.home, profile)}/config.yaml`])
    const line = r.stdout.trim().split('\n').pop() ?? ''
    let parsed: z.infer<typeof ReadOut> | null = null
    try {
      const p = ReadOut.safeParse(JSON.parse(line))
      parsed = p.success ? p.data : null
    } catch {
      parsed = null
    }
    if (!parsed) return { ok: false, error: 'failed', detail: text(r) }
    if (!parsed.ok) return { ok: false, error: parsed.error, ...(parsed.detail ? { detail: parsed.detail } : {}) }
    const slots = {} as AuxSlots
    for (const k of AUX_KEYS) (slots as Record<string, unknown>)[k] = parsed.slots[k] ?? { provider: 'auto', model: '', baseUrl: '', hasKey: false }
    return { ok: true, slots }
  }

  async save(req: AuxSaveRequest): Promise<AuxSaveResult> {
    if (!PROFILE_RE.test(req.profile)) return { ok: false, error: 'bad-request', detail: 'Unknown agent.' }
    const plan = buildAuxSave(req)
    if (!plan.ok) return { ok: false, error: 'bad-request', detail: plan.error }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected', detail: 'Not connected to the server.' }
    const pa = req.profile === 'default' ? [] : ['-p', req.profile]
    for (const [i, step] of plan.steps.entries()) {
      this.d.log?.(`aux: config set ${step[0]} ${step[1] || "''"}`)
      const r = await run(this.d.conn, [h.path, ...pa, 'config', 'set', ...step])
      if (r.code !== 0) return { ok: false, error: 'failed', step: i, detail: text(r) }
    }
    const after = await this.read(req.profile)
    return { ok: true, slots: after.ok ? after.slots : null }
  }
}
