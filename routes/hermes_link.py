"""Authenticated app-facing routes for the independent Hermes live worker."""
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from hermes_link_common import enqueue, replies, status  # pyright: ignore[reportMissingImports]


def handle(h, method, path):
    if not path.startswith("/api/hermes_link/"):
        return False
    try:
        if method == "GET" and path == "/api/hermes_link/status":
            h.send_json(200, status())
        elif method == "GET" and path == "/api/hermes_link/replies":
            after = int(parse_qs(urlparse(h.path).query).get("after", ["0"])[0])
            if after < 0:
                raise ValueError("after must be a nonnegative message ID")
            h.send_json(200, replies(after))
        elif method == "POST" and path == "/api/hermes_link/send":
            body = h.body()
            if not isinstance(body, dict):
                raise ValueError("JSON object required")
            item = enqueue(body.get("text"))
            h.send_json(202, {"ok": True, "queued": True, "id": item["id"]})
        else:
            h.send_json(404, {"error": "unknown hermes_link route"})
    except (ValueError, TypeError) as exc:
        h.send_json(400, {"error": str(exc)})
    return True
