"""Private replay API. Existing server authentication runs before this module."""
import ipaddress
import json
from urllib.parse import parse_qs, urlparse

from tools import replay_common as replay
replay.start_watcher()


def reply(h, code, obj):
    raw = json.dumps(obj).encode()
    h.send_response(code)
    h.send_header('Content-Type', 'application/json')
    h.send_header('Content-Length', str(len(raw)))
    h.send_header('Cache-Control', 'no-store, private')
    h.end_headers()
    h.wfile.write(raw)


def handle(h, method, path):
    if not path.startswith('/api/replay/'):
        return False
    ip = ipaddress.ip_address(h.client_address[0])
    if not (ip.is_loopback or ip in ipaddress.ip_network('100.64.0.0/10') or ip in ipaddress.ip_network('fd7a:115c:a1e0::/48')):
        reply(h, 403, {'error': 'Tailnet only'})
        return True
    q = parse_qs(urlparse(h.path).query)
    val = lambda k, default=None: q.get(k, [default])[0]
    try:
        if method == 'POST' and path == '/api/replay/batch':
            n = int(h.headers.get('Content-Length', 0))
            if not 0 < n <= 2_000_000:
                reply(h, 413, {'error': 'Batch size limit'})
                return True
            result = replay.ingest(h.body())
        elif method == 'GET' and path == '/api/replay/sessions':
            result = {'sessions': replay.sessions()[:200]}
        elif method == 'GET' and path == '/api/replay/events':
            m = replay.choose_session(val('session'), val('at'))
            result = replay.load_events(m['id'], after=max(0, int(val('after', 0))), at=val('at'), recent=val('recent') == '1')
        elif method == 'GET' and path == '/api/replay/timeline':
            result = {'timeline': replay.timeline(val('session'), since=val('since'), until=val('until'), limit=min(1000, max(1, int(val('limit', 300)))))}
        else:
            reply(h, 404, {'error': 'Unknown replay endpoint'})
            return True
        reply(h, 200, result)
    except (ValueError, TypeError) as exc:
        reply(h, 400, {'error': str(exc)})
    return True
