"""Calibration route tests; every write stays in an owned scratch directory."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("garden_ar", Path(__file__).resolve().parents[1] / "routes" / "ar.py")
assert spec is not None and spec.loader is not None
ar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ar)


def record():
    return {"version": 1, "plan": "[[0,0],[3,0],[3,3],[0,3]]", "transform": {"angle": 0, "tx": 0, "tz": 0, "floor": 0, "error": 0}, "corners": [0, 1], "points": [{"x": 0, "y": 0, "z": 0}, {"x": 3, "y": 0, "z": 0}], "anchorHandles": [None, None], "savedAt": "2026-10-18T18:00:00.000Z"}


class Handler:
    def __init__(self, data=None):
        self.data = data
        self.headers = {"Content-Length": str(len(json.dumps(data)))}
        self.status = self.result = None

    def body(self):
        return self.data

    def send_json(self, status, result):
        self.status, self.result = status, result


class Calibration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="garden-ar-", dir=os.environ["TMPDIR"])
        self.previous = ar.DATA
        setattr(ar, "DATA", Path(self.tmp.name) / "ar")

    def tearDown(self):
        setattr(ar, "DATA", self.previous)
        self.tmp.cleanup()

    def test_roundtrip_readback_and_private_atomic_file(self):
        h = Handler(record())
        self.assertTrue(ar.handle(h, "POST", "/api/ar/calib"))
        self.assertEqual(h.status, 200)
        read = Handler()
        ar.handle(read, "GET", "/api/ar/calib")
        self.assertEqual(read.result, record())
        self.assertEqual((ar.DATA / "calib.json").stat().st_mode & 0o777, 0o600)
        self.assertFalse((ar.DATA / "calib.json.tmp").exists())

    def test_invalid_payloads_do_not_create_storage(self):
        for bad in [None, [], {}, {**record(), "corners": [1, 1]}, {**record(), "plan": "../state.json"}, {**record(), "points": []}, {**record(), "anchorHandles": ["x"]}, {**record(), "transform": {"angle": float("nan")}}]:
            h = Handler(bad)
            ar.handle(h, "POST", "/api/ar/calib")
            self.assertEqual(h.status, 400)
        self.assertFalse(ar.DATA.exists())

    def test_empty_get_method_and_path_boundaries(self):
        h = Handler()
        ar.handle(h, "GET", "/api/ar/calib")
        self.assertIsNone(h.result)
        self.assertFalse(ar.handle(h, "GET", "/api/state"))
        ar.handle(h, "GET", "/api/ar/../state")
        self.assertEqual(h.status, 404)
        ar.handle(h, "DELETE", "/api/ar/calib")
        self.assertEqual(h.status, 405)

    def test_oversized_payload(self):
        h = Handler(record())
        h.headers["Content-Length"] = "20000"
        ar.handle(h, "POST", "/api/ar/calib")
        self.assertEqual(h.status, 400)


if __name__ == "__main__":
    unittest.main()
