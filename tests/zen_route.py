"""Exercise real HTTP requests against the route with a disposable journal directory."""
import importlib.util
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from typing import Any

spec = importlib.util.spec_from_file_location("zen", Path(__file__).resolve().parents[1] / "routes" / "zen.py")
assert spec is not None and spec.loader is not None
zen: Any = importlib.util.module_from_spec(spec)
spec.loader.exec_module(zen)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def body(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))

    def send_json(self, code, obj):
        payload = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if not zen.handle(self, "GET", self.path):
            self.send_json(404, {})

    def do_PUT(self):
        zen.handle(self, "PUT", self.path)

    def do_POST(self):
        zen.handle(self, "POST", self.path)


class ZenRouteTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="zen-route-", dir=os.environ["TMPDIR"])
        self.original = zen.DATA
        zen.DATA = Path(self.directory.name) / "data" / "zen"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        zen.DATA = self.original
        self.directory.cleanup()

    def request(self, method="GET", data=None, path="/api/zen/progress"):
        payload = json.dumps(data).encode() if data is not None else None
        try:
            with urlopen(Request(self.url + path, data=payload, method=method), timeout=5) as r:
                return r.status, json.loads(r.read())
        except HTTPError as e:
            try:
                return e.code, json.loads(e.read())
            finally:
                e.close()

    def test_durable_roundtrip_and_conflict(self):
        code, p = self.request()
        self.assertEqual((code, p["revision"]), (200, 0))
        p.update(care={"basil": {"watered": 1792350000000}}, xp=8, coins=3, log=[{"id": "basil", "action": "water", "at": 1792350000000}])
        code, saved = self.request("PUT", p)
        self.assertEqual((code, saved["revision"]), (200, 1))
        code, readback = self.request()
        self.assertEqual(readback["care"]["basil"]["watered"], p["care"]["basil"]["watered"])
        self.assertEqual(json.loads((zen.DATA / "progress.json").read_text()), readback)
        self.assertFalse((zen.DATA / ".progress.tmp").exists())
        code, conflict = self.request("PUT", p)
        self.assertEqual(code, 409)
        self.assertEqual(conflict["progress"], readback)

    def test_rejects_malformed_and_oversized_journals(self):
        for p in ([], {"v": 1, "care": []}, {"v": 1, "coins": -1}, {"v": 1, "care": {"basil": {"watered": "yesterday"}}}, {"v": 1, "log": [{"id": "a", "action": "delete", "at": 1}]}):
            self.assertEqual(self.request("PUT", p)[0], 400)
        self.assertEqual(self.request("PUT", {"v": 1, "huge": "x" * 180_001})[0], 413)
        self.assertFalse(zen.DATA.exists())

    def test_owns_only_zen_routes_and_allowed_methods(self):
        self.assertFalse(zen.handle(None, "GET", "/api/state"))
        self.assertEqual(self.request(path="/api/zen/nope")[0], 404)
        self.assertEqual(self.request("POST", {})[0], 405)


if __name__ == "__main__":
    unittest.main(verbosity=2)
