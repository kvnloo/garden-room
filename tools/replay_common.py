#!/usr/bin/env python3
"""Local replay storage and complaint context. Stdlib, private files, bounded reads."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'replay'
VOICE = ROOT / 'data' / 'voice'
LOCK = threading.RLock()
CONTEXT_LOCK = threading.Lock()
MAX_BYTES = 2_000_000_000
MAX_AGE = 7 * 86400
DISK_BYTES = None
LAST_PRUNE = 0
ID = re.compile(r'^[a-zA-Z0-9_-]{1,100}$')


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix('.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, ensure_ascii=False, separators=(',', ':'))
    tmp.replace(path)


def read(path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def millis(value):
    if value is None:
        return time.time() * 1000
    try:
        n = float(value)
        return n if n > 100_000_000_000 else n * 1000
    except (ValueError, TypeError):
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp() * 1000


def redact(value):
    text = json.dumps(value, ensure_ascii=False)
    try:
        key = (ROOT / 'data/.token').read_text().strip()
        if key:
            text = text.replace(key, '[redacted]')
    except OSError:
        pass
    text = re.sub(r'([?&#](?:k|key|token|access_token|client_secret)=)[^&#\s"<>]*', r'\1[redacted]', text, flags=re.I)
    text = re.sub(r'Bearer\s+[A-Za-z0-9._~-]+', 'Bearer [redacted]', text, flags=re.I)
    return json.loads(text)


def sessions():
    return sorted((m for p in (DATA / 'sessions').glob('*/meta.json') if (m := read(p))), key=lambda m: m['updated'], reverse=True)


def choose_session(sid=None, at=None):
    if sid:
        if not ID.fullmatch(sid):
            raise ValueError('Invalid session')
        m = read(DATA / 'sessions' / sid / 'meta.json')
        if not m:
            raise ValueError('Session not found')
        return m
    all_sessions = sessions()
    if at is not None:
        target = millis(at)
        matching = [s for s in all_sessions if s['started'] <= target + 1000 and s['updated'] * 1000 >= target - 10000]
        if matching:
            return min(matching, key=lambda s: abs(s['last_ts'] - target))
    if not all_sessions:
        raise ValueError('No recorded sessions yet')
    return all_sessions[0]


def load_events(sid, after=0, at=None, recent=False, limit=200):
    m = choose_session(sid)
    d = DATA / 'sessions' / m['id']
    paths = sorted(d.glob('batch-*.json'))
    if recent or at is not None:
        target = millis(at) if at is not None else m['last_ts']
        # Checkpoints at 60 s: retain 130 s to include a full snapshot before target.
        paths = [p for p in paths if target - 130000 <= p.stat().st_mtime * 1000 <= target + 10000]
        # On old replays use event times, not mtime (clock skew / imported files).
        if not paths:
            paths = sorted(d.glob('batch-*.json'))[-140:]
    else:
        paths = [p for p in paths if int(p.stem.split('-')[1]) > after]
    paths = paths[-limit:] if recent or at is not None else paths[:limit]
    events, cursor = [], after
    for p in paths:
        b = read(p, {})
        events.extend(b.get('events', []))
        cursor = max(cursor, b.get('batch', 0))
    events.sort(key=lambda e: e['timestamp'])
    if at is not None:
        target = millis(at)
        events = [e for e in events if e['timestamp'] <= target]
    # Drop unplayable increments before the last full checkpoint for fast attach.
    if recent or at is not None:
        full = [i for i, e in enumerate(events) if e.get('type') == 2]
        if full:
            i = full[-1]
            meta = next((e for e in reversed(events[:i]) if e.get('type') == 4), None)
            events = ([meta] if meta else []) + events[i:]
    return {'session': m, 'events': events, 'cursor': cursor, 'has_more': cursor < m['batch'] and at is None}


def tail_lines(path, max_bytes=2_000_000):
    try:
        with path.open('rb') as f:
            f.seek(0, 2)
            n = f.tell()
            start = max(0, n - max_bytes)
            f.seek(start)
            if start:
                f.readline()
            for line in f:
                if not line.endswith(b'\n'):
                    break
                try:
                    row = json.loads(line)
                    if isinstance(row, dict):
                        yield row
                except ValueError:
                    pass
    except OSError:
        return


def inbox_id(item):
    identifier = str(item.get('id', ''))
    if ID.fullmatch(identifier):
        return identifier
    # Voice transport predates UUIDs. Stable content ID also used by bridge sidecars.
    return hashlib.sha256(json.dumps(item, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()[:32]


def timeline(sid=None, since=None, until=None, limit=300):
    m = choose_session(sid, until)
    end = millis(until) if until is not None else max(time.time() * 1000, m['last_ts'])
    start = millis(since) if since is not None else end - 30000
    rows = []
    for row in tail_lines(DATA / 'sessions' / m['id'] / 'timeline.jsonl'):
        if start <= row.get('ts', 0) <= end:
            rows.append(row)
    for row in tail_lines(VOICE / 'events.jsonl'):
        ts = millis(row.get('ts', 0))
        if start <= ts <= end:
            rows.append({'ts': ts, 'kind': 'voice', 'data': redact(row)})
    for row in tail_lines(VOICE / 'inbox.jsonl'):
        ts = millis(row.get('ts', 0))
        if start <= ts <= end:
            rows.append({'ts': ts, 'kind': row.get('kind', 'complaint'), 'id': inbox_id(row), 'data': redact(row)})
    rows.sort(key=lambda r: r['ts'])
    return rows[-limit:]


def prune(force=False):
    """Enforce cap across sessions AND complaint artifacts; oldest whole group first."""
    global DISK_BYTES, LAST_PRUNE
    now = time.time()
    if not force and DISK_BYTES is not None and DISK_BYTES < MAX_BYTES and now - LAST_PRUNE < 60:
        return DISK_BYTES
    groups = [(p.stat().st_mtime, p.stat().st_size, p) for p in DATA.glob('*') if p.is_file()]
    for parent in ('sessions', 'complaints'):
        for d in (DATA / parent).glob('*'):
            if not d.is_dir():
                continue
            files = [p for p in d.rglob('*') if p.is_file()]
            latest = max((p.stat().st_mtime for p in files), default=d.stat().st_mtime)
            size = sum(p.stat().st_size for p in files)
            groups.append((latest, size, d))
    total = sum(g[1] for g in groups)
    for latest, size, d in sorted(groups):
        if now - latest > MAX_AGE or total > MAX_BYTES:
            if d.is_dir():
                shutil.rmtree(d)
            else:
                d.unlink(missing_ok=True)
            total -= size
    # Sidecars expire with their artifacts, including failed captures.
    for p in (VOICE / 'inbox_context').glob('*.json'):
        if now - p.stat().st_mtime > MAX_AGE:
            p.unlink(missing_ok=True)
    DISK_BYTES, LAST_PRUNE = total, now
    return total


def ingest(body):
    global DISK_BYTES
    if not isinstance(body, dict) or not ID.fullmatch(str(body.get('session', ''))):
        raise ValueError('Invalid session')
    sid, batch, events = body['session'], body.get('batch'), body.get('events')
    if isinstance(batch, bool) or not isinstance(batch, int) or not 1 <= batch <= 10000000:
        raise ValueError('Invalid batch')
    if not isinstance(events, list) or not 1 <= len(events) <= 3000:
        raise ValueError('Invalid events')
    if any(not isinstance(e, dict) or not isinstance(e.get('timestamp'), (int, float)) or e.get('type') not in range(7) for e in events):
        raise ValueError('Invalid rrweb event')
    safe = redact(body)
    if len(json.dumps(safe)) > 2_000_000:
        raise ValueError('Batch too large')
    with LOCK:
        d = DATA / 'sessions' / sid
        d.mkdir(parents=True, exist_ok=True, mode=0o700)
        target = d / f'batch-{batch:08d}.json'
        if target.exists():
            return {'ok': True, 'duplicate': True, 'batch': batch}
        meta = read(d / 'meta.json', {'id': sid, 'started': min(e['timestamp'] for e in events), 'batch': 0, 'events': 0})
        if batch != meta['batch'] + 1:
            raise ValueError('Out of sequence batch')
        atomic(target, safe)
        rows = []
        for e in safe['events']:
            data = e.get('data', {})
            if e['type'] == 5 and data.get('tag') == 'gr:lifecycle':
                payload = data.get('payload', {})
                if 'recording' in payload:
                    meta['recording'] = bool(payload['recording'])
                if 'hidden' in payload:
                    meta['hidden'] = bool(payload['hidden'])
            if e['type'] == 5 and str(data.get('tag', '')).startswith('gr:') and data['tag'] != 'gr:frame':
                rows.append({'ts': e['timestamp'], 'kind': data['tag'][3:], 'data': data.get('payload')})
        if rows:
            fd = os.open(d / 'timeline.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, 'a') as f:
                for row in rows:
                    f.write(json.dumps(row, ensure_ascii=False) + '\n')
        meta.update(updated=time.time(), last_ts=max(e['timestamp'] for e in events), batch=batch, events=meta['events'] + len(events))
        atomic(d / 'meta.json', meta)
        if DISK_BYTES is not None:
            DISK_BYTES += target.stat().st_size + sum(len(json.dumps(r, ensure_ascii=False).encode()) + 1 for r in rows) + 500
        prune()
    return {'ok': True, 'batch': batch}


def prepare_context(item):
    """Idempotently capture at complaint time. Never blocks ingest/HTTP threads."""
    identifier = inbox_id(item)
    sidecar = VOICE / 'inbox_context' / (identifier + '.json')
    with CONTEXT_LOCK:
        existing = read(sidecar)
        if existing and existing.get('status') == 'ready':
            return existing
        d = DATA / 'complaints' / identifier
        d.mkdir(parents=True, exist_ok=True, mode=0o700)
        at = millis(item.get('ts'))
        result = {'id': identifier, 'at': at, 'status': 'unavailable', 'directory': str(d), 'snapshot': None, 'timeline': str(d / 'timeline.json'), 'errors': str(d / 'errors.json')}
        try:
            m = choose_session(at=at)
            result['session'] = m['id']
            rows = timeline(m['id'], since=at - 30000, until=at + 1000)
            atomic(d / 'timeline.json', rows)
            atomic(d / 'errors.json', [r for r in rows if r['kind'] in ('error', 'rejection', 'fetch') or r['kind'] == 'console' and r.get('data', {}).get('level') == 'error'])
            if m.get('recording') is False or m.get('hidden') or at - m['last_ts'] > 15000 or m['started'] > at + 1000:
                raise ValueError('No active recording at complaint time (paused/offline)')
            # No shell/credentials in argv. Snapshot reads authenticated key internally.
            proc = subprocess.run(['python3', str(ROOT / 'tools/replay_snapshot.py'), '--session', m['id'], '--at', str(at), '--output', str(d / 'snapshot.png')], cwd=ROOT, capture_output=True, text=True, timeout=25)
            if proc.returncode:
                raise RuntimeError(proc.stderr[-1000:] or 'Snapshot process failed')
            result.update(status='ready', snapshot=str(d / 'snapshot.png'))
        except Exception as exc:
            result['error'] = str(exc)[:1200]
        atomic(d / 'context.json', result)
        atomic(sidecar, result)
        with LOCK:
            prune(force=True)
        return result


def delivery_context(item):
    identifier = inbox_id(item)
    sidecar = VOICE / 'inbox_context' / (identifier + '.json')
    d = DATA / 'complaints' / identifier
    result = read(sidecar) or {'id': identifier, 'status': 'pending', 'directory': str(d),
                              'snapshot': str(d / 'snapshot.png'), 'timeline': str(d / 'timeline.json'),
                              'errors': str(d / 'errors.json')}
    return {**result, 'sidecar': str(sidecar)}


def start_watcher():
    def watch():
        # Re-scan bounded recent records, including any left by a restart.
        while True:
            try:
                for item in tail_lines(VOICE / 'inbox.jsonl', 256000):
                    if item.get('kind') not in ('complaint', 'bug', 'request') or time.time() - millis(item.get('ts', 0)) / 1000 > 120:
                        continue
                    if not (VOICE / 'inbox_context' / (inbox_id(item) + '.json')).exists():
                        # Allow the final in-flight one-second recording batch to arrive.
                        age = time.time() - millis(item.get('ts', 0)) / 1000
                        if age >= 1.5:
                            prepare_context(item)
                with LOCK:
                    prune()
            except Exception:
                pass  # Ingest remains available; bridge helper retries explicitly.
            time.sleep(1)
    threading.Thread(target=watch, name='replay-complaints', daemon=True).start()
