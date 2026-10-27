"""Concurrent simulator smoke: verifies unique-event accounting and replay deduplication."""
from __future__ import annotations

import argparse
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import websocket


def envelope(message_type: str, payload: dict) -> str:
    return json.dumps({"protocolVersion": 1, "type": message_type, "payload": payload})


def connect(endpoint: str, token: str, client: str) -> websocket.WebSocket:
    socket = websocket.create_connection(endpoint, timeout=3)
    socket.send(envelope("auth.hello", {"token": token, "client": client}))
    return socket


def publish(endpoint: str, token: str, gift_id: str, count: int, client_index: int) -> None:
    socket = connect(endpoint, token, "simulator")
    try:
        for _ in range(count):
            payload = {
                "id": str(uuid.uuid4()),
                "username": f"load_viewer_{client_index}",
                "giftId": gift_id,
                "giftName": "Load smoke gift",
                "quantity": 1,
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": "simulator",
            }
            message = envelope("gift.event", payload)
            socket.send(message)
            socket.send(message)
    finally:
        socket.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=100, help="unique events per concurrent client")
    parser.add_argument("--clients", type=int, default=4, help="simultaneous simulator connections")
    parser.add_argument("--endpoint", default="ws://127.0.0.1:39177")
    parser.add_argument("--token", default=os.environ.get("CHAOS_TOKEN"), help="Local auth token; alternatively set CHAOS_TOKEN")
    args = parser.parse_args()
    if not args.token:
        raise SystemExit("provide --token or set CHAOS_TOKEN")
    if args.count < 1 or args.clients < 1:
        raise SystemExit("count and clients must be positive")

    gift_id = f"load-smoke-{uuid.uuid4()}"
    observer = connect(args.endpoint, args.token, "dashboard")
    try:
        observer.send(envelope("catalog.upsert", {
            "id": gift_id,
            "name": "Load smoke gift",
            "costVerified": False,
            "active": True,
            "requiredQuantity": 1,
            "effectIds": ["player.ragdoll"],
            "cooldownMs": 0,
            "priority": 0,
        }))
        time.sleep(0.15)
        baseline = 0
        observer.settimeout(0.2)
        try:
            while True:
                message = json.loads(observer.recv())
                if message.get("type") == "stats.snapshot":
                    baseline = max(baseline, int(message["payload"].get("giftsReceived", 0)))
        except Exception:
            pass

        with ThreadPoolExecutor(max_workers=args.clients) as pool:
            futures = [pool.submit(publish, args.endpoint, args.token, gift_id, args.count, index) for index in range(args.clients)]
            for future in futures:
                future.result()

        expected_unique = args.count * args.clients
        deadline = time.time() + max(5, expected_unique / 20)
        observed = baseline
        succeeded_effects = 0
        while time.time() < deadline and (observed < baseline + expected_unique or succeeded_effects < 1):
            try:
                message = json.loads(observer.recv())
                if message.get("type") == "stats.snapshot":
                    observed = max(observed, int(message["payload"].get("giftsReceived", 0)))
                if message.get("type") == "result" and message.get("payload", {}).get("status") == "succeeded":
                    succeeded_effects += 1
            except Exception:
                pass
        if observed < baseline + expected_unique:
            raise AssertionError(f"expected {expected_unique} unique gifts after baseline {baseline}, observed {observed}")
        if succeeded_effects < 1:
            raise AssertionError("expected at least one succeeded effect ACK; run with Mock GTA connected")
        print(json.dumps({"clients": args.clients, "uniquePerClient": args.count, "uniqueEvents": expected_unique, "replayedTransmissions": expected_unique * 2, "baseline": baseline, "observedUniqueGifts": observed - baseline, "succeededEffects": succeeded_effects}))
    finally:
        try:
            observer.send(envelope("catalog.remove", {"id": gift_id}))
        except Exception:
            pass
        observer.close()


if __name__ == "__main__":
    main()
