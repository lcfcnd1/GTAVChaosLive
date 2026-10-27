"""Verify overlay layout synchronization and persistence through the local WebSocket."""
from __future__ import annotations

import asyncio
import json
import os
import sys

import websockets


async def receive_config(socket):
    while True:
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=5))
        if message.get("type") == "overlay.config":
            return message["payload"]


async def main() -> None:
    token = os.environ.get("CHAOS_TOKEN")
    if not token:
        raise SystemExit("CHAOS_TOKEN is required for overlay-config-smoke")
    async with websockets.connect("ws://127.0.0.1:39177", ping_interval=20) as socket:
        await socket.send(json.dumps({"protocolVersion": 1, "type": "auth.hello", "payload": {"token": token, "client": "dashboard"}}))
        initial = await receive_config(socket)
        expected = {"gameplayShare": 70, "columns": 6, "visibleCount": 30, "compact": True, "fontScale": 0.9, "gap": 6, "backgroundOpacity": 0.8, "alertDurationMs": 5500, "soundEnabled": False, "iconScale": 1.2, "cardBackground": "#101820", "cardBorder": "#b8ff39"}
        await socket.send(json.dumps({"protocolVersion": 1, "type": "overlay.config", "payload": expected}))
        observed = await receive_config(socket)
        if observed != expected:
            raise AssertionError({"expected": expected, "observed": observed})
    async with websockets.connect("ws://127.0.0.1:39177", ping_interval=20) as socket:
        await socket.send(json.dumps({"protocolVersion": 1, "type": "auth.hello", "payload": {"token": token, "client": "overlay"}}))
        persisted = await receive_config(socket)
    if persisted != expected:
        raise AssertionError({"expectedAfterReconnect": expected, "persisted": persisted})
    print(json.dumps({"initial": initial, "updated": observed, "afterReconnect": persisted}))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
