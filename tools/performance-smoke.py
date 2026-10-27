"""Verify performance profile synchronization and persistence."""
from __future__ import annotations

import asyncio
import json
import os
import sys

import websockets


async def receive_performance(socket):
    while True:
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=5))
        if message.get("type") == "performance.config":
            return message["payload"]


async def main() -> None:
    token = os.environ.get("CHAOS_TOKEN")
    if not token:
        raise SystemExit("CHAOS_TOKEN is required for performance-smoke")
    expected = {"profile": "low", "queueLimit": 25, "maxActiveEffects": 8}
    async with websockets.connect("ws://127.0.0.1:39177", ping_interval=20) as socket:
        await socket.send(json.dumps({"protocolVersion": 1, "type": "auth.hello", "payload": {"token": token, "client": "dashboard"}}))
        initial = await receive_performance(socket)
        await socket.send(json.dumps({"protocolVersion": 1, "type": "performance.config", "payload": expected}))
        updated = await receive_performance(socket)
        if updated != expected:
            raise AssertionError({"expected": expected, "updated": updated})
    async with websockets.connect("ws://127.0.0.1:39177", ping_interval=20) as socket:
        await socket.send(json.dumps({"protocolVersion": 1, "type": "auth.hello", "payload": {"token": token, "client": "dashboard"}}))
        persisted = await receive_performance(socket)
    if persisted != expected:
        raise AssertionError({"expected": expected, "persisted": persisted})
    print(json.dumps({"initial": initial, "updated": updated, "afterReconnect": persisted}))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
