"""TikTokLive adapter.

This is intentionally a thin, replaceable adapter. TikTokLive is an unofficial
reverse-engineered client; no event is treated as a verified price source.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

import websockets
from TikTokLive import TikTokLiveClient
from TikTokLive.events import ConnectEvent, DisconnectEvent, GiftEvent, LiveEndEvent

log = logging.getLogger("gta-chaos.tiktok")

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

def positive_integer(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, float) and value.is_integer() and value > 0:
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else None
    return None

def image_url_from_gift(gift: Any) -> str | None:
    value = getattr(gift, "image", None) or getattr(gift, "gift_image", None)
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return value
    if isinstance(value, dict):
        candidates = value.get("url_list") or value.get("urls") or [value.get("url")]
        return next((str(item) for item in candidates if isinstance(item, str) and item.startswith(("http://", "https://"))), None)
    for attribute in ("url_list", "urls", "url"):
        candidates = getattr(value, attribute, None)
        if isinstance(candidates, str): candidates = [candidates]
        if candidates:
            return next((str(item) for item in candidates if str(item).startswith(("http://", "https://"))), None)
    return None

def stable_event_id(event: GiftEvent) -> str:
    """Prefer TikTok's identifiers so reconnect replays deduplicate upstream."""
    for attribute in ("order_id", "event_id", "log_id"):
        value = getattr(event, attribute, None)
        if value is not None and str(value).strip():
            return f"tiktok:{attribute}:{str(value).strip()}"
    # Some test doubles and older protocol variants expose no event ID. Keep
    # those events distinct rather than collapsing legitimate identical gifts.
    return f"tiktok:local:{uuid.uuid4()}"

def gift_to_event(event: GiftEvent) -> dict[str, Any] | None:
    gift = getattr(event, "gift", None)
    if gift is None:
        return None
    # Only fields observed in the event are forwarded. Cost must be verified
    # separately from the catalog; it is never inferred from a gift event.
    user = getattr(event, "user", None)
    username = getattr(user, "unique_id", None) or getattr(user, "nickname", None) or "unknown_viewer"
    name = getattr(gift, "name", None) or getattr(gift, "gift_name", None) or "unknown_gift"
    quantity = positive_integer(getattr(event, "repeat_count", 1)) or 1
    normalized = {
        "id": stable_event_id(event), "username": str(username),
        "giftId": str(getattr(gift, "id", None) or name), "giftName": str(name),
        "quantity": max(1, quantity), "createdAt": utc_now(), "source": "tiktok",
    }
    image_url = image_url_from_gift(gift)
    if image_url: normalized["imageUrl"] = image_url
    raw_cost = positive_integer(getattr(gift, "diamond_count", None))
    if raw_cost is not None:
        normalized["coinCost"] = raw_cost
        normalized["costVerified"] = True
    return normalized

class TikTokAdapter:
    def __init__(self, unique_id: str, endpoint: str = "ws://127.0.0.1:39177", token: str | None = None):
        self.client = TikTokLiveClient(unique_id=unique_id.lstrip("@"))
        self.endpoint = endpoint
        self.token = token or os.environ.get("CHAOS_TOKEN")
        self._send: Callable[[dict[str, Any]], Awaitable[None]] | None = None
        self._send_envelope: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None
        # Register once. Registering inside run_once duplicates callbacks after
        # a reconnect and can replay a single TikTok gift multiple times.
        self.client.add_listener(ConnectEvent, self._on_connect)
        self.client.add_listener(DisconnectEvent, self._on_disconnect)
        self.client.add_listener(LiveEndEvent, self._on_live_end)
        self.client.add_listener(GiftEvent, self._on_gift)

    async def _on_connect(self, _: ConnectEvent) -> None:
        log.info("TikTok LIVE connected")
        if self._send_envelope:
            await self._send_envelope("live.status", {"state": "connected", "source": "tiktok", "updatedAt": utc_now()})

    async def _on_disconnect(self, _: DisconnectEvent) -> None:
        log.info("TikTok LIVE disconnected")
        if self._send_envelope:
            await self._send_envelope("live.status", {"state": "disconnected", "source": "tiktok", "updatedAt": utc_now()})

    async def _on_live_end(self, _: LiveEndEvent) -> None:
        log.info("TikTok LIVE ended")
        if self._send_envelope:
            await self._send_envelope("live.status", {"state": "live_ended", "source": "tiktok", "updatedAt": utc_now()})

    async def _on_gift(self, event: GiftEvent) -> None:
        # Intermediate streak updates are ignored; the final repeat is the
        # one that should trigger a gameplay effect.
        if getattr(event, "streaking", False):
            return
        normalized = gift_to_event(event)
        if normalized and self._send:
            await self._send(normalized)

    async def run_once(self) -> None:
        if not self.token:
            raise RuntimeError("CHAOS_TOKEN is required; refusing the development fallback")
        async with websockets.connect(self.endpoint, ping_interval=20) as socket:
            async def send_envelope(message_type: str, payload: dict[str, Any]) -> None:
                await socket.send(json.dumps({"protocolVersion": 1, "type": message_type, "payload": payload}))

            self._send_envelope = send_envelope
            await send_envelope("auth.hello", {"token": self.token, "client": "tiktok"})

            async def send_gift(payload: dict[str, Any]) -> None:
                await send_envelope("gift.event", payload)

            self._send = send_gift
            try:
                await self.client.connect(fetch_gift_info=True)
            finally:
                self._send = None
                self._send_envelope = None

    async def run_forever(self, retry_seconds: float = 5.0) -> None:
        while True:
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("TikTok connection failed; retrying")
                await asyncio.sleep(retry_seconds)

async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("username", help="TikTok LIVE unique_id")
    parser.add_argument("--endpoint", default="ws://127.0.0.1:39177")
    parser.add_argument("--token", default=os.environ.get("CHAOS_TOKEN"), help="Local auth token; alternatively set CHAOS_TOKEN")
    args = parser.parse_args()
    if not args.token:
        parser.error("provide --token or set CHAOS_TOKEN; refusing the development fallback")
    logging.basicConfig(level=logging.INFO)
    await TikTokAdapter(args.username, args.endpoint, args.token).run_forever()

if __name__ == "__main__":
    asyncio.run(main())
