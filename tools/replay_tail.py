#!/usr/bin/env python3
"""Compact owner-use timeline. --follow polls; no browser or service credentials printed."""
import argparse
import json
import time
from datetime import datetime
from replay_common import choose_session, timeline


def format_row(row):
    stamp = datetime.fromtimestamp(row['ts'] / 1000).astimezone().isoformat(timespec='milliseconds')
    return f"{stamp} {row['kind']:12} {json.dumps(row.get('data'), ensure_ascii=False, separators=(',', ':'))[:900]}"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--session')
    p.add_argument('--seconds', type=float, default=30)
    p.add_argument('--at')
    p.add_argument('--follow', '-f', action='store_true')
    p.add_argument('--json', action='store_true')
    a = p.parse_args()
    seen = set()
    try:
        while True:
            m = choose_session(a.session, a.at)
            from replay_common import millis
            end = millis(a.at) if a.at else time.time() * 1000
            rows = timeline(m['id'], since=end - a.seconds * 1000, until=end)
            for row in rows:
                if row['kind'] in ('performance', 'longtask'):
                    continue
                token = json.dumps(row, sort_keys=True)
                if token not in seen:
                    print(json.dumps(row, ensure_ascii=False) if a.json else format_row(row), flush=True)
                    seen.add(token)
            if not a.follow:
                break
            if len(seen) > 5000:
                seen = {json.dumps(r, sort_keys=True) for r in rows}
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    except ValueError as exc:
        p.exit(1, str(exc) + '\n')


if __name__ == '__main__':
    main()
