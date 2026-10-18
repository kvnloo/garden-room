"""Shared stdlib-only voice bridge I/O. Never writes Hermes state.db."""
import fcntl
import json
import os
import sqlite3
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VOICE = Path(os.environ.get("GARDEN_VOICE_DIR", ROOT / "data/voice"))
HOME = Path(os.environ.get("GARDEN_HERMES_HOME", "$HERMES_HOME"))
API = os.environ.get("GARDEN_HERMES_API", "http://127.0.0.1:8643")
STATE = VOICE / "hermes_link_state.json"
KEY = VOICE / ".hermes-api-key"
SESSION_KEY = "garden_room live"
MODEL = "claude-opus-5-5"
PROVIDER = "anthropic"


def ensure_files():
    VOICE.mkdir(parents=True, exist_ok=True)
    for name, content in (("inbox.jsonl", ""), ("events.jsonl", ""), ("drive.jsonl", ""),
                          ("delivered.jsonl", ""), ("rules.json", "{}\n")):
        try:
            with (VOICE / name).open("x") as f:
                f.write(content)
        except FileExistsError:
            pass


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def atomic_json(path, value):
    atomic_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def atomic_text(path, text):
    path = Path(path)
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with tmp.open("w") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(path)


def append_json(path, value):
    data = (json.dumps(value, ensure_ascii=False) + "\n").encode()
    fd = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        # One append syscall: interoperates with the voice module's JSONL appends.
        if os.write(fd, data) != len(data):
            raise OSError("short JSONL append")
        os.fsync(fd)
    finally:
        os.close(fd)


def enqueue(text, context=None):
    if not isinstance(text, str) or not text.strip() or len(text) > 16000:
        raise ValueError("text must be a nonempty string of at most 16000 characters")
    ensure_files()
    item = {"id": uuid.uuid4().hex, "ts": time.time(), "kind": "request", "text": text,
            "context": context or {"source": "hermes_link/send"}}
    append_json(VOICE / "inbox.jsonl", item)
    return item


def complete_lines(path, cursor=None, limit=100):
    """Byte cursor, including inode; never consumes an incomplete final JSON line."""
    cursor = cursor or {}
    with Path(path).open("rb") as f:
        stat = os.fstat(f.fileno())
        offset = int(cursor.get("offset", 0))
        if cursor.get("inode") != stat.st_ino or offset > stat.st_size:
            offset = 0
        f.seek(offset)
        rows = []
        for _ in range(limit):
            start = f.tell()
            raw = f.readline()
            if not raw.endswith(b"\n"):
                f.seek(start)
                break
            try:
                item = json.loads(raw)
                if not isinstance(item, dict):
                    raise ValueError("not an object")
            except (ValueError, UnicodeError):
                item = {"_invalid_json": True, "byte_offset": start}
            rows.append(item)
        return rows, {"inode": stat.st_ino, "offset": f.tell()}


def session_lineage(db, root):
    ids = [root] if root else []
    for _ in range(100):
        if not ids:
            break
        row = db.execute("SELECT id FROM sessions WHERE parent_session_id=? "
                         "AND source NOT IN ('subagent','oneshot','tool','cron') "
                         "ORDER BY started_at DESC LIMIT 1", (ids[-1],)).fetchone()
        if not row or row[0] in ids:
            break
        ids.append(row[0])
    return ids


def replies(after=0, limit=100):
    state = read_json(STATE, {})
    root = state.get("session_id")
    if not root:
        return {"session_id": None, "messages": [], "replies": [], "next_after": after, "has_more": False}
    db = sqlite3.connect(f"file:{HOME / 'state.db'}?mode=ro", uri=True, timeout=3)
    try:
        ids = session_lineage(db, root)
        marks = ",".join("?" for _ in ids)
        rows = db.execute(f"SELECT id,content,timestamp FROM messages WHERE session_id IN ({marks}) "
                          "AND id>? AND active=1 AND role='assistant' AND content IS NOT NULL AND trim(content)!='' "
                          "ORDER BY id ASC LIMIT ?", (*ids, after, limit + 1)).fetchall()
    finally:
        db.close()
    messages = [{"id": mid, "role": "assistant", "text": text, "ts": ts} for mid, text, ts in rows[:limit]]
    return {"session_id": ids[-1], "messages": messages, "replies": messages,
            "next_after": messages[-1]["id"] if messages else after, "has_more": len(rows) > limit}


def status():
    ensure_files()
    state = read_json(STATE, {})
    cursor = state.get("inbox_cursor")
    depth = 0
    while True:
        batch, cursor = complete_lines(VOICE / "inbox.jsonl", cursor, 1000)
        depth += len(batch)
        if len(batch) < 1000:
            break
    heartbeat = state.get("heartbeat", 0)
    return {"name": SESSION_KEY, "session_id": state.get("live_session_id") or state.get("session_id"),
            "root_session_id": state.get("session_id"), "model": MODEL, "provider": PROVIDER,
            "worker_alive": time.time() - heartbeat < 15, "worker_pid": state.get("pid"),
            "last_delivery": state.get("last_delivery"), "queue_depth": depth,
            "pending": state.get("pending", {}).get("id"), "run_id": state.get("pending", {}).get("run_id"),
            "phase": state.get("phase", "starting"), "error": state.get("error"), "heartbeat": heartbeat}
