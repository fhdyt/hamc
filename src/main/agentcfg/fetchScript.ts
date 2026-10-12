/**
 * Lists the models of an OpenAI-compatible endpoint from the server (so endpoints that only the VPS can reach work).
 * Run as `python -c <script> <base_url>`: the script is an argument and holds no secret, the API key arrives on stdin.
 * It prints one JSON line: {ok, status, models:[{id, ctx}]} or {ok:false, error, status?, detail?}. ASCII only.
 */
export const FETCH_MODELS_PY = `import json, sys, urllib.request, urllib.error
base = sys.argv[1].rstrip('/')
key = sys.stdin.readline().strip()
def done(o):
    sys.stdout.write(json.dumps(o) + chr(10))
    sys.exit(0)
if not (base.startswith('http://') or base.startswith('https://')):
    done({'ok': False, 'error': 'bad-request', 'detail': 'not an http(s) url'})
req = urllib.request.Request(base + '/models', headers={'Accept': 'application/json', 'User-Agent': 'mission-control'})
if key:
    req.add_header('Authorization', 'Bearer ' + key)
    req.add_header('x-api-key', key)
    req.add_header('anthropic-version', '2023-06-01')
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        status = r.status
        body = r.read(4000000)
except urllib.error.HTTPError as e:
    done({'ok': False, 'error': 'http', 'status': e.code, 'detail': (e.reason or '')[:200] if isinstance(e.reason, str) else ''})
except urllib.error.URLError as e:
    done({'ok': False, 'error': 'timeout' if 'timed out' in str(e.reason) else 'network', 'detail': str(e.reason)[:200]})
except Exception as e:
    done({'ok': False, 'error': 'timeout' if 'timed out' in str(e) else 'network', 'detail': type(e).__name__})
try:
    data = json.loads(body.decode('utf-8', 'replace'))
except Exception:
    done({'ok': False, 'error': 'invalid', 'status': status, 'detail': 'the answer is not JSON'})
items = data.get('data') if isinstance(data, dict) else data
if items is None and isinstance(data, dict):
    items = data.get('models')
if not isinstance(items, list):
    done({'ok': False, 'error': 'invalid', 'status': status, 'detail': 'no model list in the answer'})
out = []
for m in items[:5000]:
    if isinstance(m, str):
        out.append({'id': m, 'ctx': None})
    elif isinstance(m, dict) and isinstance(m.get('id'), str):
        ctx = m.get('context_length') or m.get('context_window') or m.get('max_context_length')
        out.append({'id': m['id'], 'ctx': ctx if isinstance(ctx, int) else None})
done({'ok': True, 'status': status, 'models': out})
`
