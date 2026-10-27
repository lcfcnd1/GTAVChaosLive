"""Real-GTA smoke test; refuses to pass when only the mock adapter is connected."""

import argparse
import json
import os
import time
import uuid

import websocket


def envelope(message_type, payload):
    return json.dumps({"protocolVersion": 1, "type": message_type, "payload": payload})


def main() -> int:
    parser = argparse.ArgumentParser(description="Send one authenticated effect command to the real GTA mod.")
    parser.add_argument("--endpoint", default="ws://127.0.0.1:39177")
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--token", default=os.environ.get("CHAOS_TOKEN"), help="Local auth token; alternatively set CHAOS_TOKEN")
    parser.add_argument("--effect-id", default="player.ragdoll", help="Registered effect ID to test")
    parser.add_argument("--parameters", default='{"durationMs":750}', help="JSON object with safe effect parameters")
    args = parser.parse_args()
    if not args.token:
        parser.error("provide --token or set CHAOS_TOKEN; refusing the development fallback")
    if not args.effect_id or len(args.effect_id) > 64 or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for character in args.effect_id):
        parser.error("--effect-id must be a bounded registered-effect ID")
    try:
        parameters = json.loads(args.parameters)
    except json.JSONDecodeError as error:
        parser.error(f"--parameters must be valid JSON: {error}")
    if not isinstance(parameters, dict):
        parser.error("--parameters must be a JSON object")

    command_id = str(uuid.uuid4())
    created_at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    expires_at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 15))
    socket = websocket.create_connection(args.endpoint, timeout=2)
    socket.send(envelope("auth.hello", {"token": args.token, "client": "dashboard"}))
    socket.settimeout(0.25)
    deadline = time.time() + args.timeout
    command_sent = False
    gta_source = None
    advertised_effects = set()

    def send_if_ready():
        nonlocal command_sent
        if gta_source == "gta-mod" and not command_sent and args.effect_id in advertised_effects:
            socket.send(envelope("effect.command", {
                "id": command_id,
                "effectId": args.effect_id,
                "parameters": parameters,
                "createdAt": created_at,
                "expiresAt": expires_at,
            }))
            command_sent = True

    try:
        while time.time() < deadline:
            try:
                message = json.loads(socket.recv())
            except Exception:
                continue
            if message.get("type") == "service.status":
                status = message.get("payload", {})
                if status.get("gta") == "connected":
                    gta_source = status.get("gtaSource")
            if message.get("type") == "effects.snapshot":
                advertised_effects = {
                    item.get("id") for item in message.get("payload", [])
                    if isinstance(item, dict) and isinstance(item.get("id"), str)
                }
            send_if_ready()
            if message.get("type") == "result" and message.get("payload", {}).get("id") == command_id:
                result = message["payload"]
                print(json.dumps({"gtaSource": gta_source, "status": result.get("status"), "effectId": result.get("effectId"), "error": result.get("error")}))
                return 0 if result.get("status") == "succeeded" and gta_source == "gta-mod" else 1
    finally:
        socket.close()

    if gta_source != "gta-mod":
        print(json.dumps({"status": "not_run", "reason": "real_gta_mod_not_connected", "observedGtaSource": gta_source}))
    elif not command_sent:
        print(json.dumps({"status": "not_run", "reason": "effect_not_advertised", "effectId": args.effect_id, "advertisedEffects": sorted(advertised_effects)}))
    else:
        print(json.dumps({"status": "timeout", "reason": "real_gta_ack_not_received", "gtaSource": gta_source}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
