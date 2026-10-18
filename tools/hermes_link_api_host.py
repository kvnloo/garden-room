#!/usr/bin/env python3
"""Host Hermes's native API adapter, without host-wide cron/kanban/messaging startup.

This intentionally does NOT construct GatewayRunner or call start_gateway(). The native
adapter still runs AIAgent, full configured tools, durable runs and SessionDB persistence.
"""
import asyncio
import logging
import os
import signal
import sys
from pathlib import Path

sys.path.insert(0, os.environ.get("GARDEN_HERMES_SOURCE", "$HERMES_ROOT/hermes-agent"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import hermes_bootstrap  # noqa: F401 - installed runtime initialization
from hermes_link_common import HOME, KEY, ROOT
from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)
    # No other adapter is instantiated. Do not load a GatewayRunner, process registry,
    # kanban dispatcher, cron ticker, recovery watcher or another profile's stores.
    adapter = APIServerAdapter(PlatformConfig(enabled=True, extra={
        "host": "127.0.0.1", "port": 8643, "key": KEY.read_text().strip(),
        "model_name": "garden-room-live", "cors_origins": [], "direct_model_requests": True}))
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopped.set)
    if not await adapter.connect():
        await adapter.disconnect()
        raise RuntimeError("native Hermes API adapter did not start")
    logging.info("garden_room API-only host pid=%s home=%s cwd=%s adapters=[api_server]; Telegram/Discord NOT started; cron/kanban NOT started", os.getpid(), HOME, ROOT)
    try:
        await stopped.wait()
    finally:
        # Let admitted turns settle before closing their state.db connection. Never
        # stop/kill the owner's CLI; only this adapter's own runs are drained.
        tasks = list(getattr(adapter, "_active_run_tasks", {}).values())
        if tasks:
            _done, pending = await asyncio.wait(tasks, timeout=120)
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        await adapter.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
