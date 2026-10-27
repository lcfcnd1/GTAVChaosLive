"""Verify local WebSocket role restrictions and one-time authentication."""
from __future__ import annotations

import argparse
import json
import os
import time

import websocket
from websocket import WebSocketConnectionClosedException, WebSocketTimeoutException


def envelope(message_type: str, payload: dict) -> str:
    return json.dumps({"protocolVersion": 1, "type": message_type, "payload": payload})


def connect(endpoint: str, token: str, client: str) -> websocket.WebSocket:
    socket = websocket.create_connection(endpoint, timeout=2)
    socket.send(envelope("auth.hello", {"token": token, "client": client}))
    socket.settimeout(0.2)
    return socket


def drain(socket: websocket.WebSocket, seconds: float = 0.4) -> list[dict]:
    messages: list[dict] = []
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            messages.append(json.loads(socket.recv()))
        except Exception:
            pass
    return messages


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="ws://127.0.0.1:39177")
    parser.add_argument("--token", default=os.environ.get("CHAOS_TOKEN"))
    args = parser.parse_args()
    if not args.token:
        parser.error("provide --token or set CHAOS_TOKEN")

    dashboard = connect(args.endpoint, args.token, "dashboard")
    simulator = connect(args.endpoint, args.token, "simulator")
    try:
        drain(dashboard)
        drain(simulator)
        simulator.send(envelope("system.pause", {"reason": "role_smoke_forbidden"}))
        forbidden_reply = [
            message for message in drain(simulator, 0.6)
            if message.get("type") == "result" and message.get("payload", {}).get("error") == "role_smoke_forbidden"
        ]
        if forbidden_reply:
            raise AssertionError("simulator role was allowed to pause the system")

        catalog_id = f"role-smoke-{int(time.time() * 1000)}"
        simulator.send(envelope("catalog.upsert", {
            "id": catalog_id, "name": "Role smoke", "costVerified": False, "active": True,
            "requiredQuantity": 1, "effectIds": [], "cooldownMs": 0, "priority": 0,
        }))
        accepted = [
            message for message in drain(simulator, 1.0)
            if message.get("type") == "result" and message.get("payload", {}).get("id") == catalog_id
        ]
        if not accepted or accepted[-1]["payload"].get("status") != "accepted":
            raise AssertionError("simulator could not publish an allowed catalog update")

        renegotiation = connect(args.endpoint, args.token, "dashboard")
        try:
            drain(renegotiation)
            renegotiation.send(envelope("auth.hello", {"token": args.token, "client": "gta"}))
            closed = False
            deadline = time.time() + 2
            try:
                while time.time() < deadline:
                    renegotiation.recv()
            except WebSocketTimeoutException:
                pass
            except WebSocketConnectionClosedException:
                closed = True
            if not closed:
                raise AssertionError("authentication replay was not closed")
        finally:
            renegotiation.close()
    finally:
        dashboard.close()
        simulator.close()
    print(json.dumps({"forbiddenSystemControl": "blocked", "allowedCatalogUpdate": "accepted", "authReplay": "closed"}))


if __name__ == "__main__":
    main()
