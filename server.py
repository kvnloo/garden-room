#!/usr/bin/env python3
"""garden_room server: static app + layouts + render requests + portal to one Hermes chat.

The portal types into the tmux pane that runs `hermes -p clean --resume <session>` and reads the
replies back from that profile's state.db. Stdlib only.
"""
import argparse, base64, json, os, re, secrets, sqlite3, subprocess, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = ROOT / "data"
RENDERS = DATA / "renders"
SCANS = DATA / "scans"
TOKEN_FILE = DATA / ".token"
HERMES_HOME = Path(os.environ.get("GARDEN_HERMES_HOME", "$HERMES_HOME"))
SESSION_ID = os.environ.get("GARDEN_SESSION_ID", "20261018_121653_552390")
TMUX_TARGET = os.environ.get("GARDEN_TMUX", "garden_room")
LOCK = threading.Lock()

DATA.mkdir(exist_ok=True)
RENDERS.mkdir(exist_ok=True)
SCANS.mkdir(exist_ok=True)
if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_urlsafe(18))
    TOKEN_FILE.chmod(0o600)
TOKEN = TOKEN_FILE.read_text().strip()


def latest_session(db):
    """Follow compression continuations (child sessions) to the live tip."""
    sid = SESSION_ID
    for _ in range(50):
        row = db.execute("select id from sessions where parent_session_id=? and source not in ('subagent','oneshot','tool','cron') "
                         "order by started_at desc limit 1", (sid,)).fetchone()
        if not row:
            return sid
        sid = row[0]
    return sid


def chat_messages(after_id=0, limit=60):
    db = sqlite3.connect(f"file:{HERMES_HOME / 'state.db'}?mode=ro", uri=True, timeout=5)
    try:
        sid = latest_session(db)
        rows = db.execute(
            "select id, role, content, timestamp from messages where session_id=? and id>? and active=1 "
            "and role in ('user','assistant') and content is not null and trim(content)!='' "
            "order by id desc limit ?", (sid, after_id, limit)).fetchall()
    finally:
        db.close()
    out = []
    for mid, role, content, ts in reversed(rows):
        if role == "user" and content.startswith("[OUT-OF-BAND"):
            content = re.sub(r"^\[OUT-OF-BAND[^\]]*\]\s*|\s*\[/OUT-OF-BAND USER MESSAGE\]\s*$", "", content)
        out.append({"id": mid, "role": role, "text": content[:6000], "ts": ts})
    return {"session": sid, "messages": out}


def tmux_alive():
    return subprocess.run(["tmux", "has-session", "-t", TMUX_TARGET], capture_output=True).returncode == 0


def send_to_chat(text):
    text = " ".join(text.split())  # one line: a newline would submit early in the CLI prompt
    if not text:
        return False, "empty"
    if not tmux_alive():
        return False, f"tmux session '{TMUX_TARGET}' not running; start bin/portal on the desktop"
    with LOCK:
        subprocess.run(["tmux", "send-keys", "-t", TMUX_TARGET, "-l", text], check=True)
        time.sleep(0.15)
        subprocess.run(["tmux", "send-keys", "-t", TMUX_TARGET, "Enter"], check=True)
    return True, "sent"


RENDER_QUEUE, RENDER_LOCK = [], threading.Lock()
COMFY_PY = "$PRIVATE_DATA"


def render_worker():
    """One render at a time; each request dir gets render.log next to its outputs."""
    if not RENDER_LOCK.acquire(blocking=False):
        return
    try:
        while RENDER_QUEUE:
            d = RENDER_QUEUE.pop(0)
            env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME")}
            with open(d / "render.log", "w") as log:
                rc = subprocess.run([COMFY_PY, str(ROOT / "tools" / "render_real.py"), str(d)], stdout=log, stderr=subprocess.STDOUT, env=env).returncode
            if rc:
                st = read_json(d / "status.json", {}); st.update(state="failed", rc=rc); (d / "status.json").write_text(json.dumps(st))
    finally:
        RENDER_LOCK.release()
    if RENDER_QUEUE:
        render_worker()


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return default


def list_scans():
    items = []
    for d in sorted(SCANS.iterdir(), reverse=True):
        if d.is_dir():
            files = sorted(p.name for p in d.iterdir() if p.is_file())
            items.append({"id": d.name, "media": [f for f in files if re.search(r"\.(jpe?g|png|webp|heic|mp4|mov|webm)$", f, re.I)],
                          "status": read_json(d / "status.json", {"state": "uploading"}),
                          "layout": read_json(d / "layout.json", None)})
    return items


def list_renders():
    items = []
    for d in sorted(RENDERS.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        files = sorted(p.name for p in d.iterdir() if p.is_file())
        items.append({"id": d.name, "files": files, "status": read_json(d / "status.json", {"state": "requested"})})
    return items


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def authed(self):
        q = parse_qs(urlparse(self.path).query)
        return self.headers.get("X-Garden-Key") == TOKEN or q.get("k", [""])[0] == TOKEN

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 40_000_000:
            raise ValueError("too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def translate_path(self, path):
        p = urlparse(path).path
        for prefix, base in (("/vendor/three/", ROOT / "node_modules" / "three"),
                             ("/vendor/spark/", ROOT / "node_modules" / "@sparkjsdev" / "spark"),
                             ("/vendor/fonts/", ROOT / "node_modules" / "@fontsource"),
                             ("/renders/", RENDERS), ("/scans/", SCANS), ("/history/thumbs/", DATA / "history" / "thumbs")):
            if p.startswith(prefix):
                target = (base / p[len(prefix):]).resolve()
                return str(target) if target.is_relative_to(base.resolve()) else str(base / "__denied__")
        return super().translate_path(path)

    def do_GET(self):
        p = urlparse(self.path)
        if p.path.startswith("/api/") and self.authed() and try_routes(self, "GET"):
            return
        if p.path.startswith("/api/"):
            if not self.authed():
                return self.send_json(401, {"error": "key"})
            if p.path == "/api/state":
                return self.send_json(200, read_json(DATA / "state.json", {}))
            if p.path == "/api/layouts":
                return self.send_json(200, read_json(DATA / "layouts.json", []))
            if p.path == "/api/chat":
                after = int(parse_qs(p.query).get("after", ["0"])[0])
                try:
                    res = chat_messages(after)
                except Exception as e:  # db busy etc.
                    return self.send_json(200, {"messages": [], "error": str(e)})
                res["portal"] = tmux_alive()
                return self.send_json(200, res)
            if p.path == "/api/renders":
                return self.send_json(200, list_renders())
            if p.path == "/api/scans":
                return self.send_json(200, list_scans())
            return self.send_json(404, {"error": "nope"})
        return super().do_GET()

    def do_PUT(self):
        p = urlparse(self.path)
        if not self.authed():
            return self.send_json(401, {"error": "key"})
        if try_routes(self, "PUT"):
            return
        m = re.fullmatch(r"/api/scan/(\d{8}-\d{6})/([\w.-]{1,80})", p.path)
        if m and re.search(r"\.(jpe?g|png|webp|heic|mp4|mov|webm)$", m.group(2), re.I):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 400_000_000:
                return self.send_json(413, {"error": "too large"})
            d = SCANS / m.group(1); d.mkdir(exist_ok=True)
            with open(d / m.group(2), "wb") as f:
                left = n
                while left:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk: break
                    f.write(chunk); left -= len(chunk)
            return self.send_json(200, {"ok": True, "bytes": n})
        if p.path in ("/api/state", "/api/layouts"):
            data = self.body()
            target = DATA / ("state.json" if p.path == "/api/state" else "layouts.json")
            tmp = target.with_suffix(".tmp")
            tmp.write_text(json.dumps(data))
            tmp.replace(target)
            return self.send_json(200, {"ok": True})
        return self.send_json(404, {"error": "nope"})

    def do_POST(self):
        p = urlparse(self.path)
        if not self.authed():
            return self.send_json(401, {"error": "key"})
        if try_routes(self, "POST"):
            return
        if p.path == "/api/chat":
            ok, msg = send_to_chat("[garden_room phone] " + str(self.body().get("text", ""))[:4000])
            return self.send_json(200 if ok else 503, {"ok": ok, "detail": msg})
        if p.path == "/api/scan":
            rid = time.strftime("%Y%m%d-%H%M%S"); (SCANS / rid).mkdir(exist_ok=True)
            (SCANS / rid / "status.json").write_text(json.dumps({"state": "uploading"}))
            return self.send_json(200, {"id": rid})
        m = re.fullmatch(r"/api/scan/(\d{8}-\d{6})/done", p.path)
        if m:
            d = SCANS / m.group(1); note = str(self.body().get("note", ""))[:500]
            n = len([f for f in d.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".heic", ".mp4", ".mov", ".webm")])
            (d / "status.json").write_text(json.dumps({"state": "sent", "note": note, "count": n}))
            ok, msg = send_to_chat(
                f"[garden_room phone] Room scan {d} ({n} files). Reconstruct the room layout from it (walls polygon, window, "
                f"doors, furniture + plant positions in metres, same schema as data/state.json) and write {d}/layout.json; "
                f"the app will offer to import it. Note: {note}")
            return self.send_json(200, {"ok": True, "chat": ok, "detail": msg})
        if p.path == "/api/render":
            data = self.body()
            rid = time.strftime("%Y%m%d-%H%M%S")
            d = RENDERS / rid
            d.mkdir(parents=True, exist_ok=True)
            for key in ("top", "view"):
                uri = data.get(key) or ""
                if uri.startswith("data:image/"):
                    (d / f"{key}.jpg").write_bytes(base64.b64decode(uri.split(",", 1)[1]))
            (d / "layout.json").write_text(json.dumps(data.get("layout", {}), indent=1))
            (d / "status.json").write_text(json.dumps({"state": "requested", "note": data.get("note", "")}))
            RENDER_QUEUE.append(d)
            threading.Thread(target=render_worker, daemon=True).start()
            ok, msg = send_to_chat(
                f"[garden_room phone] Render request {d} queued (auto pipeline: gpt-image-2 photo, panorama, SHARP splat). "
                f"Review the result and iterate if it misses the layout. Note: {data.get('note','')}")
            return self.send_json(200, {"ok": True, "id": rid, "chat": ok, "detail": msg})
        return self.send_json(404, {"error": "nope"})


ROUTES = []


def load_routes():
    import importlib.util
    for f in sorted((ROOT / "routes").glob("*.py")):
        if f.name.startswith("_"):
            continue
        spec = importlib.util.spec_from_file_location("routes." + f.stem, f)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        ROUTES.append(mod); print("route module", f.stem, flush=True)


def try_routes(h, method):
    path = urlparse(h.path).path
    for mod in ROUTES:
        try:
            if mod.handle(h, method, path):
                return True
        except Exception as e:  # a broken module must not take the app down
            h.send_json(500, {"error": f"{mod.__name__}: {e}"}); return True
    return False


def main():
    load_routes()
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", action="append", default=None)
    ap.add_argument("--port", type=int, default=8790)
    a = ap.parse_args()
    hosts = a.host or ["127.0.0.1"]
    servers = [ThreadingHTTPServer((h, a.port), Handler) for h in hosts]
    for s in servers[1:]:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    print(f"garden_room on {hosts} :{a.port}", flush=True)
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
