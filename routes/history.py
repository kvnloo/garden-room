"""Authenticated private history API. Source paths/EXIF never leave the server."""
import json
import re
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

DATA = Path(__file__).resolve().parents[1] / 'data/history'
LOCK = threading.RLock()
_CACHE = (None, {})
PLANTS = {f'p{i:02}' for i in range(1, 26)}


def index():
    global _CACHE
    p = DATA / 'index.json'
    try:
        stamp = p.stat().st_mtime_ns
    except FileNotFoundError:
        return {'photos': [], 'plants': {}}
    with LOCK:
        if _CACHE[0] != stamp:
            _CACHE = (stamp, json.loads(p.read_text()))
        return _CACHE[1]


def overrides():
    try:
        return json.loads((DATA / 'overrides.json').read_text())
    except FileNotFoundError:
        return {}


def public_photo(p, edits, plant=None):
    assignments = {a['id']: dict(a) for a in p.get('plants', [])}
    for pid, on in edits.get(p['id'], {}).items():
        if on:
            assignments[pid] = {**assignments.get(pid, {}), 'id': pid, 'score': 1, 'unsure': False, 'method': 'owner'}
        else:
            assignments.pop(pid, None)
    out = {k: p[k] for k in ('id', 'ts', 'dateSource', 'thumb512', 'thumb1600', 'bytes512', 'bytes1600', 'size') if k in p}
    out['plants'] = list(assignments.values())
    if plant:
        out['assignment'] = assignments.get(plant)
    return out


def handle(h, method, path):
    u = urlsplit(getattr(h, 'path', path))
    path = u.path
    if not path.startswith('/api/history/'):
        return False
    if method == 'GET':
        edits = overrides()
        if path.startswith('/api/history/plant/'):
            pid = path.rsplit('/', 1)[-1]
            if pid not in PLANTS:
                h.send_json(404, {'error': 'Unknown plant'})
                return True
            photos = [public_photo(p, edits, pid) for p in index().get('photos', [])]
            photos = sorted((p for p in photos if p['assignment']), key=lambda p: (p['ts'], p['id']))
            h.send_json(200, {'plant': pid, 'photos': photos, 'saplingFraction': .15, 'growth': 'illustrative logistic estimate; not measured from photographs'})
            return True
        if path == '/api/history/photos':
            q = parse_qs(u.query)
            try:
                offset = max(0, int(q.get('offset', ['0'])[0]))
                limit = min(60, max(1, int(q.get('limit', ['30'])[0])))
            except ValueError:
                h.send_json(400, {'error': 'Invalid pagination'})
                return True
            photos = sorted(index().get('photos', []), key=lambda p: (p['ts'], p['id']), reverse=True)
            h.send_json(200, {'photos': [public_photo(p, edits) for p in photos[offset:offset+limit]], 'total': len(photos), 'offset': offset, 'hasMore': offset + limit < len(photos)})
            return True
    if method == 'POST' and path == '/api/history/assign':
        body = h.body()
        if not isinstance(body, dict) or not isinstance(body.get('photo'), str) or not re.fullmatch(r'[0-9a-f]{12}', body['photo']) or not isinstance(body.get('plant'), str) or body.get('plant') not in PLANTS or type(body.get('on')) is not bool:
            h.send_json(400, {'error': 'Expected photo ID, plant ID and boolean on'})
            return True
        if not any(p['id'] == body['photo'] for p in index().get('photos', [])):
            h.send_json(404, {'error': 'Unknown photo'})
            return True
        with LOCK:
            edits = overrides()
            edits.setdefault(body['photo'], {})[body['plant']] = body['on']
            DATA.mkdir(parents=True, exist_ok=True)
            tmp = DATA / 'overrides.tmp'
            tmp.write_text(json.dumps(edits, indent=1))
            tmp.replace(DATA / 'overrides.json')
        h.send_json(200, {'ok': True, **body})
        return True
    h.send_json(404, {'error': 'Unknown history route'})
    return True
