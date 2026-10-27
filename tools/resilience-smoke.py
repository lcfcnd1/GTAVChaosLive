"""Exercise Emergency Stop, Resume and authenticated reconnect locally."""
from __future__ import annotations

import json
import os
import sys
import time

import websocket


TOKEN = os.environ.get("CHAOS_TOKEN")
if not TOKEN:
    raise SystemExit("CHAOS_TOKEN is required for resilience-smoke")


def send(socket, message_type, payload):
    socket.send(json.dumps({"protocolVersion": 1, "type": message_type, "payload": payload}))


def receive_until(socket, predicate, timeout=3):
    socket.settimeout(0.25)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            message = json.loads(socket.recv())
        except Exception:
            continue
        if predicate(message):
            return message
    raise AssertionError("No se recibió la respuesta esperada")


def main():
    socket = websocket.create_connection("ws://127.0.0.1:39177", timeout=2)
    send(socket, "auth.hello", {"token": TOKEN, "client": "dashboard"})
    receive_until(socket, lambda message: message.get("type") == "stats.snapshot")
    send(socket, "system.pause", {"reason": "resilience_smoke_pause"})
    receive_until(socket, lambda message: message.get("type") == "result" and message["payload"].get("status") == "accepted" and message["payload"].get("error") == "resilience_smoke_pause")
    send(socket, "system.resume", {"reason": "resilience_smoke_pause_resume"})
    receive_until(socket, lambda message: message.get("type") == "result" and message["payload"].get("status") == "accepted")
    send(socket, "system.stop", {"reason": "resilience_smoke"})
    receive_until(socket, lambda message: message.get("type") == "system.stop")
    send(socket, "system.resume", {"reason": "resilience_smoke_resume"})
    receive_until(socket, lambda message: message.get("type") == "result" and message["payload"].get("status") == "accepted")
    socket.close()

    reconnected = websocket.create_connection("ws://127.0.0.1:39177", timeout=2)
    send(reconnected, "auth.hello", {"token": TOKEN, "client": "dashboard"})
    receive_until(reconnected, lambda message: message.get("type") == "service.status")
    reconnected.close()
    print(json.dumps({"pause": "ok", "emergencyStop": "ok", "resume": "ok", "reconnect": "ok"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
