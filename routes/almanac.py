"""Read-only, source-attributed care reference. Never writes the owner's garden."""
import json
from pathlib import Path

SPECIES = Path(__file__).resolve().parents[1] / "data" / "almanac" / "species.json"


def handle(h, method, path):
    if not path.startswith("/api/almanac/"):
        return False
    if path != "/api/almanac/species":
        h.send_json(404, {"error": "Unknown almanac resource"})
    elif method != "GET":
        h.send_json(405, {"error": "Almanac reference is read-only"})
    else:
        h.send_json(200, json.loads(SPECIES.read_text()))
    return True
