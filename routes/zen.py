"""Authenticated, bounded care journal. Does not read or write the room layout."""
import json
import math
import os
import threading
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data" / "zen"
LOCK = threading.Lock()
MAX_BYTES = 180_000


def read_progress():
    try:
        return json.loads((DATA / "progress.json").read_text())
    except (FileNotFoundError, ValueError):
        return {"v": 1, "revision": 0}


def number(value, low=0.0, high=1e15):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def strings(value, limit=1000):
    return isinstance(value, list) and len(value) <= limit and all(isinstance(x, str) and len(x) <= 160 for x in value)


def valid(p):
    if not isinstance(p, dict) or p.get("v") != 1:
        return False
    if not all(number(p.get(k, 0)) for k in ("revision", "updated", "xp", "coins", "streak")):
        return False
    if not all(p.get(k) is None or number(p[k], -1e9, 1e9) for k in ("bestScore", "arrangementTier")):
        return False
    if not isinstance(p.get("lastVisit", ""), str) or len(p.get("lastVisit", "")) > 10 or not isinstance(p.get("muted", False), bool):
        return False
    care, days, log = p.get("care", {}), p.get("days", {}), p.get("log", [])
    if not isinstance(care, dict) or len(care) > 1000 or not isinstance(days, dict) or len(days) > 28:
        return False
    for name, c in care.items():
        if not isinstance(name, str) or len(name) > 160 or not isinstance(c, dict):
            return False
        if any(k not in ("watered", "fed", "trimmed", "checked") or not number(v) for k, v in c.items()):
            return False
    for date, d in days.items():
        if not isinstance(date, str) or len(date) != 10 or not isinstance(d, dict):
            return False
        if not all(strings(d.get(k, [])) for k in ("thirsty", "watered", "claims")):
            return False
        if not isinstance(d.get("start", ""), str) or len(d.get("start", "")) > 50_000:
            return False
        if not all(isinstance(d.get(k, False), bool) for k in ("arranged", "light")):
            return False
    if not strings(p.get("achievements", []), 100) or not isinstance(log, list) or len(log) > 128:
        return False
    return all(isinstance(e, dict) and isinstance(e.get("id"), str) and len(e["id"]) <= 160 and e.get("action") in ("water", "feed", "trim", "check") and number(e.get("at")) for e in log)


def handle(h, method, path):
    if not path.startswith("/api/zen/"):
        return False
    if path != "/api/zen/progress":
        h.send_json(404, {"error": "Unknown zen route"})
        return True
    if method == "GET":
        with LOCK:
            p = read_progress()
        h.send_json(200, p)
        return True
    if method != "PUT":
        h.send_json(405, {"error": "Use GET or PUT"})
        return True
    try:
        if int(h.headers.get("Content-Length") or 0) > MAX_BYTES:
            h.send_json(413, {"error": "Care journal too large"})
            return True
        p = h.body()
    except (ValueError, TypeError):
        h.send_json(400, {"error": "Invalid JSON"})
        return True
    if not valid(p):
        h.send_json(400, {"error": "Invalid care journal"})
        return True
    with LOCK:
        previous = read_progress()
        if p.get("revision", 0) != previous.get("revision", 0):
            h.send_json(409, {"error": "Garden updated in another tab", "progress": previous})
            return True
        p["revision"] = previous.get("revision", 0) + 1
        DATA.mkdir(parents=True, exist_ok=True)
        target = DATA / "progress.json"
        tmp = DATA / ".progress.tmp"
        try:
            with tmp.open("w") as f:
                json.dump(p, f, allow_nan=False, separators=(",", ":"))
                f.flush()
                os.fsync(f.fileno())
            tmp.replace(target)
        finally:
            tmp.unlink(missing_ok=True)
    h.send_json(200, {"ok": True, "revision": p["revision"]})
    return True
