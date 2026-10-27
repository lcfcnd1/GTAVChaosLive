"""Connect as the real overlay client and verify authenticated snapshots."""
import json
import os
import time

import websocket


token = os.environ.get("CHAOS_TOKEN")
if not token:
    raise SystemExit("CHAOS_TOKEN is required")

socket = websocket.create_connection("ws://127.0.0.1:39177", timeout=3)
socket.send(json.dumps({"protocolVersion": 1, "type": "auth.hello", "payload": {"token": token, "client": "overlay"}}))
received = []
authenticated_snapshot = False
deadline = time.time() + 5
socket.settimeout(0.5)
try:
    while time.time() < deadline:
        try:
            message = json.loads(socket.recv())
        except Exception:
            continue
        received.append(message.get("type"))
        if message.get("type") == "catalog.snapshot":
            authenticated_snapshot = True
            break
finally:
    socket.close()

print(json.dumps({"authenticatedOverlaySnapshot": authenticated_snapshot, "receivedTypes": received[:8]}))
raise SystemExit(0 if authenticated_snapshot else 1)
