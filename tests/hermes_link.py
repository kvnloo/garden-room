"""Stdlib bridge tests; fixtures stay in the approved scratch dir, never live voice data."""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import hermes_link_common as common  # pyright: ignore[reportMissingImports]
import hermes_link_worker as worker  # pyright: ignore[reportMissingImports]


class LinkTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(os.environ.get("TMPDIR", "$HERMES_HOME/cache/scratch"))
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch, prefix="hermes-link-test-")
        self.voice = Path(self.temp.name) / "voice"
        self.home = Path(self.temp.name) / "home"
        self.home.mkdir()
        self.patches = [patch.object(common, "VOICE", self.voice), patch.object(common, "HOME", self.home),
                        patch.object(common, "STATE", self.voice / "hermes_link_state.json"),
                        patch.object(worker, "VOICE", self.voice),
                        patch.object(worker, "STATE", self.voice / "hermes_link_state.json")]
        for p in self.patches:
            p.start()
        common.ensure_files()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def test_initial_files_preserve_rules(self):
        rules = self.voice / "rules.json"
        rules.write_text('{"aliases":{"heard":"action"}}')
        common.ensure_files()
        self.assertEqual(json.loads(rules.read_text())["aliases"]["heard"], "action")
        self.assertTrue(all((self.voice / f).exists() for f in ("inbox.jsonl", "events.jsonl", "drive.jsonl", "delivered.jsonl")))

    def test_complete_byte_cursor_waits_for_newline(self):
        inbox = self.voice / "inbox.jsonl"
        inbox.write_bytes(b'{"text":"first"}\n{"text":"second"}')
        rows, cursor = common.complete_lines(inbox)
        self.assertEqual([x["text"] for x in rows], ["first"])
        with inbox.open("ab") as f:
            f.write(b"\n")
        rows, _ = common.complete_lines(inbox, cursor)
        self.assertEqual([x["text"] for x in rows], ["second"])

    def test_rotation_and_bad_json(self):
        inbox = self.voice / "inbox.jsonl"
        common.append_json(inbox, {"text": "old"})
        _, cursor = common.complete_lines(inbox)
        inbox.rename(self.voice / "old.jsonl")
        inbox.write_bytes(b'bad\n{"text":"new"}\n')
        rows, _ = common.complete_lines(inbox, cursor)
        self.assertTrue(rows[0]["_invalid_json"])
        self.assertEqual(rows[1]["text"], "new")

    def test_validate_post_and_queue_depth(self):
        for text in (None, "", "  ", "x" * 16001):
            with self.assertRaises(ValueError):
                common.enqueue(text)
        common.enqueue("hello")
        self.assertEqual(common.status()["queue_depth"], 1)
        _, cursor = common.complete_lines(self.voice / "inbox.jsonl")
        common.atomic_json(common.STATE, {"inbox_cursor": cursor})
        self.assertEqual(common.status()["queue_depth"], 0)

    def test_replies_are_assistant_only_and_paginated(self):
        db = sqlite3.connect(self.home / "state.db")
        db.executescript("CREATE TABLE sessions(id TEXT,parent_session_id TEXT,source TEXT,started_at REAL);"
                         "CREATE TABLE messages(id INTEGER,session_id TEXT,role TEXT,content TEXT,timestamp REAL,active INTEGER DEFAULT 1);")
        db.executemany("INSERT INTO sessions VALUES (?,?,?,?)", [("root", None, "api_server", 1),
                                                               ("child", "root", "api_server", 2),
                                                               ("delegated", "root", "subagent", 3)])
        db.executemany("INSERT INTO messages(id,session_id,role,content,timestamp) VALUES (?,?,?,?,?)", [(1, "root", "user", "private question", 1),
                                                                  (2, "root", "assistant", "first", 2),
                                                                  (3, "child", "assistant", "second", 3),
                                                                  (4, "delegated", "assistant", "not this chat", 4)])
        db.commit()
        db.close()
        common.atomic_json(common.STATE, {"session_id": "root"})
        result = common.replies(0, 1)
        self.assertEqual(result["messages"][0]["text"], "first")
        self.assertTrue(result["has_more"])
        self.assertEqual(common.replies(result["next_after"])["messages"][0]["text"], "second")
        self.assertEqual(result["session_id"], "child")

    def test_pending_uses_stable_session_and_idempotency(self):
        state = {"session_id": "root", "live_session_id": "root"}
        worker.make_pending(state, "inbox", "hello")
        state["live_session_id"] = "later-tip"
        calls = []
        def fake_api(path, body=None, **kwargs):
            calls.append((path, body, kwargs))
            return {"run_id": "test-run"} if body else {"status": "running", "session_id": "root"}
        with patch.object(worker, "api", fake_api):
            worker.tick_pending(state)
            worker.tick_pending(state)
        submissions = [x for x in calls if x[1]]
        self.assertEqual(len(submissions), 1)
        self.assertEqual(submissions[0][1]["session_id"], "root")
        self.assertTrue(submissions[0][2]["idem"].startswith("garden-room-"))

    def test_interrupted_run_is_settled_not_stuck(self):
        state = {"session_id": "root", "seeded": True,
                 "pending": {"id": "batch", "kind": "inbox", "run_id": "test-run"}}
        with patch.object(worker, "api", return_value={"status": "interrupted"}), patch.object(worker, "digest"):
            worker.tick_pending(state)
        self.assertNotIn("pending", state)
        self.assertEqual(state["last_delivery"]["event"], "interrupted")

    def test_activity_digest_accumulates_only_active_time(self):
        common.append_json(self.voice / "events.jsonl", {"type": "correction", "text": "I meant top view"})
        state = {}
        with patch.object(worker.time, "time", return_value=100):
            worker.collect_events(state, 5)
        self.assertEqual(state["telemetry"]["count"], 1)
        self.assertEqual(len(state["telemetry"]["important"]), 1)
        with patch.object(worker.time, "time", return_value=200):
            worker.collect_events(state, 5)
        self.assertEqual(state["telemetry"]["active_seconds"], 5)
        with patch.object(worker.time, "time", return_value=110):
            for _ in range(179):
                worker.collect_events(state, 5)
        self.assertEqual(state["telemetry"]["active_seconds"], 900)


if __name__ == "__main__":
    unittest.main()
