"""Local TikTok gift simulator; it can print events or publish them to localhost."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone

import websockets

def event(gift_name: str = "Test gift", quantity: int = 1) -> dict:
    return {
        "id": str(uuid.uuid4()), "username": "simulator_viewer", "giftId": "simulator-gift",
        "giftName": gift_name, "quantity": quantity,
        "createdAt": datetime.now(timezone.utc).isoformat(), "source": "simulator",
    }

async def publish_client(count: int, endpoint: str, duplicates: bool) -> None:
    token = os.environ.get("CHAOS_TOKEN")
    if not token:
        raise RuntimeError("CHAOS_TOKEN is required for simulator publishing")
    async with websockets.connect(endpoint, ping_interval=20) as socket:
        await socket.send(json.dumps({"protocolVersion": 1, "type": "auth.hello", "payload": {"token": token, "client": "simulator"}}))
        await socket.send(json.dumps({"protocolVersion": 1, "type": "catalog.upsert", "payload": {
            "id": "simulator-gift", "name": "Test gift", "costVerified": False, "active": True,
            "requiredQuantity": 1, "effectIds": ["player.ragdoll"], "cooldownMs": 0, "priority": 1,
        }}))
        payloads = [event() for _ in range(count)]
        for payload in payloads:
            encoded = json.dumps({"protocolVersion": 1, "type": "gift.event", "payload": payload})
            await socket.send(encoded)
            if duplicates:
                await socket.send(encoded)

async def publish(count: int, endpoint: str, clients: int = 1, duplicates: bool = False) -> None:
    await asyncio.gather(*(publish_client(count, endpoint, duplicates) for _ in range(max(1, clients))))

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("count", nargs="?", type=int, default=1)
    parser.add_argument("--connect", action="store_true", help="publish to the local orchestrator")
    parser.add_argument("--clients", type=int, default=1, help="number of simultaneous simulator connections")
    parser.add_argument("--duplicates", action="store_true", help="repeat each event ID to verify deduplication")
    parser.add_argument("--endpoint", default="ws://127.0.0.1:39177")
    args = parser.parse_args()
    if args.connect:
        asyncio.run(publish(max(1, args.count), args.endpoint, args.clients, args.duplicates))
    else:
        for _ in range(max(1, args.count)):
            print(json.dumps(event()), flush=True)
            time.sleep(0.05)

if __name__ == "__main__":
    main()
