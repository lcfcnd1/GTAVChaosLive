"""Verify that an in-flight effect is requeued after the GTA client reconnects."""
from __future__ import annotations

import json
import os
import time
import uuid

import websocket


TOKEN = os.environ.get("CHAOS_TOKEN")
if not TOKEN:
    raise SystemExit("CHAOS_TOKEN is required for gta-reconnect-smoke")


def envelope(message_type: str, payload: dict) -> str:
    return json.dumps({"protocolVersion": 1, "type": message_type, "payload": payload})


def connect(client: str, source: str | None = None) -> websocket.WebSocket:
    socket = websocket.create_connection("ws://127.0.0.1:39177", timeout=3)
    payload = {"token": TOKEN, "client": client}
    if source:
        payload["source"] = source
    socket.send(envelope("auth.hello", payload))
    return socket


def receive_until(socket: websocket.WebSocket, predicate, timeout: float = 5.0) -> dict:
    socket.settimeout(0.25)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            message = json.loads(socket.recv())
        except Exception:
            continue
        if predicate(message):
            return message
    raise AssertionError("expected websocket message was not received")


def main() -> None:
    gift_id = f"reconnect-smoke-{uuid.uuid4()}"
    dashboard = connect("dashboard")
    first_gta = connect("gta", "mock-gta")
    second_gta = None
    try:
        dashboard.send(envelope("catalog.upsert", {
            "id": gift_id,
            "name": "Reconnect smoke gift",
            "costVerified": False,
            "active": True,
            "requiredQuantity": 1,
            "effectIds": ["player.ragdoll"],
            "cooldownMs": 0,
            "priority": 1,
        }))
        time.sleep(0.15)
        dashboard.send(envelope("gift.event", {
            "id": str(uuid.uuid4()),
            "username": "reconnect_viewer",
            "giftId": gift_id,
            "giftName": "Reconnect smoke gift",
            "quantity": 1,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": "simulator",
        }))
        first_command = receive_until(first_gta, lambda message: message.get("type") == "effect.command")
        command = first_command["payload"]
        first_gta.close()
        time.sleep(0.25)

        second_gta = connect("gta", "mock-gta")
        replayed = receive_until(second_gta, lambda message: message.get("type") == "effect.command")
        if replayed["payload"].get("id") != command.get("id"):
            raise AssertionError("reconnected GTA received a different command ID")
        second_gta.send(envelope("result", {
            "id": command["id"],
            "effectId": command["effectId"],
            "status": "succeeded",
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }))
        result = receive_until(dashboard, lambda message: message.get("type") == "result" and message.get("payload", {}).get("id") == command["id"] and message["payload"].get("status") == "succeeded")
        print(json.dumps({"commandId": command["id"], "requeuedAfterDisconnect": True, "status": result["payload"]["status"]}))
    finally:
        try:
            dashboard.send(envelope("catalog.remove", {"id": gift_id}))
        except Exception:
            pass
        dashboard.close()
        first_gta.close()
        if second_gta:
            second_gta.close()


if __name__ == "__main__":
    main()
