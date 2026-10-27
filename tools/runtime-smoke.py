"""Small localhost smoke test for the authenticated orchestrator path."""

import json
import os
import time
import uuid

import websocket

TOKEN = os.environ.get("CHAOS_TOKEN")
if not TOKEN:
    raise SystemExit("CHAOS_TOKEN is required for runtime-smoke")


def send(socket, message_type, payload):
    socket.send(json.dumps({"protocolVersion": 1, "type": message_type, "payload": payload}))


socket = websocket.create_connection("ws://127.0.0.1:39177", timeout=2)
send(socket, "auth.hello", {"token": TOKEN, "client": "simulator"})
time.sleep(0.1)
send(socket, "catalog.upsert", {
    "id": "runtime-rose",
    "name": "Runtime Rose",
    "costVerified": True,
    "coinCost": 1,
    "active": True,
    "requiredQuantity": 1,
    "effectIds": ["player.ragdoll"],
    "cooldownMs": 0,
    "priority": 1,
})
send(socket, "effect.upsert", {
    "id": "player.ragdoll",
    "name": "Ragdoll runtime",
    "description": "Runtime smoke configuration",
    "category": "PLAYER",
    "defaultDurationMs": 1000,
    "intensity": 1,
    "probability": 1,
    "cooldownMs": 0,
    "compatibility": "both",
    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
})
send(socket, "gift.event", {
    "id": str(uuid.uuid4()),
    "username": "runtime_viewer",
    "giftId": "runtime-rose",
    "giftName": "Runtime Rose",
    "imageUrl": "https://example.test/runtime-rose.png",
    "quantity": 1,
    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "source": "simulator",
})

socket.settimeout(0.4)
messages = []
deadline = time.time() + 1.5
while time.time() < deadline:
    try:
        message = json.loads(socket.recv())
        if message.get("type") in {"result", "catalog.snapshot", "effects.snapshot", "stats.snapshot", "sessions.snapshot", "analytics.snapshot"}:
            messages.append(message)
    except Exception:
        pass
result_messages = [message for message in messages if message["type"] == "result"]
assert any(message["payload"].get("status") == "accepted" for message in result_messages), messages
assert any(message["type"] == "catalog.snapshot" and any(gift["id"] == "runtime-rose" for gift in message["payload"]) for message in messages), messages
assert any(message["type"] == "effects.snapshot" and any(effect["id"] == "player.ragdoll" for effect in message["payload"]) for message in messages), messages
assert any(message["type"] == "effects.snapshot" and any(effect["id"] == "world.weather" and effect["category"] == "WORLD" for effect in message["payload"]) for message in messages), messages
assert any(message["type"] == "effects.snapshot" and any(effect["id"] == "vehicle.engine_off" and effect["category"] == "VEHICLE" for effect in message["payload"]) for message in messages), messages
assert any(message["type"] == "sessions.snapshot" and message["payload"] for message in messages), messages
assert any(message["type"] == "analytics.snapshot" and "Runtime Rose" in message["payload"]["gifts"] for message in messages), messages
assert any(message["payload"].get("status") == "succeeded" and message["payload"].get("imageUrl") == "https://example.test/runtime-rose.png" for message in result_messages), messages
send(socket, "catalog.remove", {"id": "runtime-rose"})
socket.settimeout(0.4)
removal_messages = []
removal_deadline = time.time() + 0.8
while time.time() < removal_deadline:
    try:
        message = json.loads(socket.recv())
        if message.get("type") in {"result", "catalog.snapshot"}:
            removal_messages.append(message)
    except Exception:
        pass
assert any(message["payload"].get("status") == "accepted" and message["payload"].get("id") == "runtime-rose" for message in removal_messages if message["type"] == "result"), removal_messages
assert any(message["type"] == "catalog.snapshot" and not any(gift["id"] == "runtime-rose" for gift in message["payload"]) for message in removal_messages), removal_messages
socket.close()
print(json.dumps({"received": len(messages), "results": [message["payload"].get("status") for message in result_messages]}))
