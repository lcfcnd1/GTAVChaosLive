"""End-to-end validation that refuses mock-gta and requires a real mod ACK."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from urllib.request import Request, urlopen

import websocket


ROUTES = ("/overlay/vertical", "/overlay/gifts", "/overlay/alerts", "/overlay/chaos")


def envelope(message_type, payload):
    return json.dumps({"protocolVersion": 1, "type": message_type, "payload": payload})


def check_overlay(token):
    checked = []
    for route in ROUTES:
        with urlopen(Request(f"http://127.0.0.1:39178{route}?token={token}"), timeout=3) as response:
            if response.status != 200 or response.headers.get_content_type() != "text/html":
                raise RuntimeError(f"overlay_route_failed:{route}")
            checked.append(route)
    return checked


def recv_until(socket, deadline, state, command_id):
    while time.time() < deadline:
        try:
            message = json.loads(socket.recv())
        except Exception:
            continue
        message_type = message.get("type")
        payload = message.get("payload") or {}
        if message_type == "service.status":
            state["gta"] = payload.get("gta")
            state["gtaSource"] = payload.get("gtaSource")
        elif message_type == "effects.snapshot":
            state["effects"] = {item.get("id") for item in payload if isinstance(item, dict)}
        elif message_type == "result" and payload.get("id") == command_id:
            state["result"] = payload
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate desktop runtime, orchestrator, real GTA mod ACK and overlay.")
    parser.add_argument("--token", default=os.environ.get("CHAOS_TOKEN"))
    parser.add_argument("--effect-id", default="player.recover_health")
    parser.add_argument("--parameters", default='{"durationMs":250}')
    parser.add_argument("--desktop-exe", default="apps/desktop/src-tauri/target/release/gta-chaos-live.exe")
    parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args()
    if not args.token:
        parser.error("provide --token or set CHAOS_TOKEN")
    if not os.path.isfile(args.desktop_exe):
        print(json.dumps({"status": "not_ready", "reason": "desktop_executable_missing"}))
        return 2
    try:
        parameters = json.loads(args.parameters)
        if not isinstance(parameters, dict):
            raise ValueError("parameters_not_object")
        overlay_routes = check_overlay(args.token)
    except Exception as error:
        print(json.dumps({"status": "failed", "stage": "application_or_overlay", "error": str(error)}))
        return 1

    command_id = str(uuid.uuid4())
    now = time.time()
    command = {"id": command_id, "effectId": args.effect_id, "parameters": parameters,
               "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(now)),
               "expiresAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(now + 15))}
    dashboard = websocket.create_connection("ws://127.0.0.1:39177", timeout=0.25)
    overlay = websocket.create_connection("ws://127.0.0.1:39177", timeout=0.25)
    dashboard.send(envelope("auth.hello", {"token": args.token, "client": "dashboard"}))
    overlay.send(envelope("auth.hello", {"token": args.token, "client": "overlay"}))
    dashboard_state = {"effects": set(), "gta": None, "gtaSource": None}
    overlay_state = {"effects": set(), "gta": None, "gtaSource": None}
    try:
        deadline = time.time() + args.timeout
        while time.time() < deadline and (dashboard_state["gtaSource"] != "gta-mod" or args.effect_id not in dashboard_state["effects"]):
            recv_until(dashboard, min(deadline, time.time() + 0.5), dashboard_state, command_id)
        if dashboard_state["gtaSource"] != "gta-mod":
            print(json.dumps({"status": "not_run", "reason": "gta_source_not_real", "observedGtaSource": dashboard_state["gtaSource"], "mockRejected": dashboard_state["gtaSource"] == "mock-gta"}))
            return 3
        if args.effect_id not in dashboard_state["effects"]:
            print(json.dumps({"status": "not_run", "reason": "effect_not_advertised", "effectId": args.effect_id}))
            return 2
        dashboard.send(envelope("effect.command", command))
        ack = recv_until(dashboard, deadline, dashboard_state, command_id)
        overlay_ack = recv_until(overlay, deadline, overlay_state, command_id)
        result = dashboard_state.get("result") or {}
        passed = ack and overlay_ack and result.get("status") == "succeeded" and dashboard_state["gtaSource"] == "gta-mod"
        print(json.dumps({"status": "passed" if passed else "failed", "application": "present", "orchestrator": "authenticated", "gtaSource": dashboard_state["gtaSource"], "realAck": ack and result.get("status") == "succeeded", "overlayReceivedResult": overlay_ack, "overlayRoutes": overlay_routes, "effectId": args.effect_id, "result": result}))
        return 0 if passed else 1
    finally:
        dashboard.close()
        overlay.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status": "failed", "error": str(error)}))
        raise
