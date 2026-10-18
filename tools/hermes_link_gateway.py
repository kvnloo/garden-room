#!/usr/bin/env python3
"""Launch the clean API host with a private loopback API key (never logged)."""
import os
import secrets
import subprocess
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_link_common import API, HOME, KEY, ROOT, ensure_files

ensure_files()
try:
    fd = os.open(KEY, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
except FileExistsError:
    pass
else:
    with os.fdopen(fd, "w") as f:
        f.write(secrets.token_urlsafe(32))
KEY.chmod(0o600)
os.environ.update(HERMES_HOME=str(HOME), API_SERVER_ENABLED="true", API_SERVER_HOST="127.0.0.1",
                  API_SERVER_PORT="8643", API_SERVER_KEY=KEY.read_text().strip(),
                  TERMINAL_CWD=str(ROOT), HERMES_DASHBOARD="0")
os.chdir(ROOT)
# Use the installed Hermes interpreter/dependencies, not system Python. Run the native
# API adapter only: gateway.run also starts cross-profile cron/kanban schedulers.
launcher = str(Path.home() / ".local/bin/hermes")
runtime = json.loads(subprocess.check_output([launcher, "--print-runtime-command"], text=True))
os.execv(runtime[0], [runtime[0], "-I", str(ROOT / "tools/hermes_link_api_host.py")])
