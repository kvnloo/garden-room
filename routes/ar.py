"""Authenticated calibration storage only; no photos or owner layout mutations."""
import json
import math
import os
from pathlib import Path
import threading

DATA = Path(__file__).resolve().parents[1] / "data" / "ar"
LOCK = threading.Lock()


def validate(v):
    if not isinstance(v, dict) or v.get("version") != 1:
        raise ValueError("version must be 1")
    t = v.get("transform", {})
    if not isinstance(t, dict) or not all(isinstance(t.get(k), (int, float)) and not isinstance(t[k], bool) and math.isfinite(t[k]) and abs(t[k]) < 1000 for k in ("angle", "tx", "tz", "floor", "error")):
        raise ValueError("invalid rigid transform")
    poly = json.loads(v.get("plan", ""))
    if not isinstance(poly, list) or not 3 <= len(poly) <= 32 or not all(isinstance(p, list) and len(p) == 2 and all(isinstance(x, (int, float)) and math.isfinite(x) and abs(x) < 100 for x in p) for p in poly):
        raise ValueError("invalid room polygon")
    corners = v.get("corners")
    if not isinstance(corners, list) or len(corners) != 2 or corners[0] == corners[1] or not all(type(i) is int and 0 <= i < len(poly) for i in corners):
        raise ValueError("invalid corners")
    points = v.get("points")
    if not isinstance(points, list) or len(points) != 2 or not all(isinstance(p, dict) and all(isinstance(p.get(k), (int, float)) and math.isfinite(p[k]) and abs(p[k]) < 100 for k in ("x", "y", "z")) for p in points):
        raise ValueError("invalid points")
    handles = v.get("anchorHandles")
    if not isinstance(handles, list) or len(handles) != 2 or not all(h is None or isinstance(h, str) and 1 <= len(h) <= 256 for h in handles):
        raise ValueError("invalid anchor handles")
    if not isinstance(v.get("savedAt"), str) or not 10 <= len(v["savedAt"]) <= 40:
        raise ValueError("invalid timestamp")
    return {k: v[k] for k in ("version", "plan", "transform", "corners", "points", "anchorHandles", "savedAt")}


def handle(h, method, path):
    if not path.startswith("/api/ar/"):
        return False
    if path != "/api/ar/calib":
        h.send_json(404, {"error": "not found"})
        return True
    if method == "GET":
        with LOCK:
            try:
                v = json.loads((DATA / "calib.json").read_text())
            except (OSError, ValueError):
                v = None
        h.send_json(200, v)
    elif method == "POST":
        try:
            if int(h.headers.get("Content-Length", "0")) > 16384:
                raise ValueError("calibration too large")
            v = validate(h.body())
        except (ValueError, TypeError, KeyError, OverflowError) as e:
            h.send_json(400, {"error": str(e)})
            return True
        with LOCK:
            DATA.mkdir(parents=True, exist_ok=True)
            tmp = DATA / "calib.json.tmp"
            with tmp.open("w") as f:
                os.chmod(tmp, 0o600)
                json.dump(v, f, allow_nan=False)
                f.flush()
                os.fsync(f.fileno())
            tmp.replace(DATA / "calib.json")
        h.send_json(200, {"ok": True})
    else:
        h.send_json(405, {"error": "method not allowed"})
    return True
