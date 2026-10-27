import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("connector.py")
SPEC = importlib.util.spec_from_file_location("gta_chaos_tiktok_connector", MODULE_PATH)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

class ConnectorTests(unittest.TestCase):
    def test_normalizes_gift_without_inventing_price(self):
        event = SimpleNamespace(
            gift=SimpleNamespace(id=42, name="Rose"),
            user=SimpleNamespace(unique_id="viewer_1"),
            repeat_count=3,
        )
        normalized = module.gift_to_event(event)
        self.assertEqual(normalized["giftId"], "42")
        self.assertEqual(normalized["quantity"], 3)
        self.assertNotIn("coinCost", normalized)

    def test_uses_protocol_gift_name_when_display_name_is_missing(self):
        event = SimpleNamespace(
            gift=SimpleNamespace(id=7, name="", gift_name="TikTok Gift"),
            user=SimpleNamespace(unique_id="viewer_2"),
            repeat_count=1,
        )
        normalized = module.gift_to_event(event)
        self.assertEqual(normalized["giftName"], "TikTok Gift")

    def test_forwards_observed_image_url_only(self):
        event = SimpleNamespace(
            gift=SimpleNamespace(id=8, name="Rose", image=SimpleNamespace(url_list=["https://example.test/rose.png"])),
            user=SimpleNamespace(unique_id="viewer_3"), repeat_count=1,
        )
        normalized = module.gift_to_event(event)
        self.assertEqual(normalized["imageUrl"], "https://example.test/rose.png")

    def test_forwards_positive_diamond_count_as_observed_cost(self):
        event = SimpleNamespace(
            gift=SimpleNamespace(id=9, name="Galaxy", diamond_count=100),
            user=SimpleNamespace(unique_id="viewer_4"), repeat_count=1,
        )
        normalized = module.gift_to_event(event)
        self.assertEqual(normalized["coinCost"], 100)
        self.assertTrue(normalized["costVerified"])

    def test_normalizes_integer_like_protocol_metadata_without_inventing_price(self):
        event = SimpleNamespace(
            gift=SimpleNamespace(id=10, name="Galaxy", diamond_count="100"),
            user=SimpleNamespace(unique_id="viewer_5"), repeat_count="4",
        )
        normalized = module.gift_to_event(event)
        self.assertEqual(normalized["coinCost"], 100)
        self.assertEqual(normalized["quantity"], 4)

    def test_rejects_fractional_or_non_numeric_price_metadata(self):
        event = SimpleNamespace(
            gift=SimpleNamespace(id=11, name="Unknown", diamond_count="100.5"),
            user=SimpleNamespace(unique_id="viewer_6"), repeat_count=1,
        )
        normalized = module.gift_to_event(event)
        self.assertNotIn("coinCost", normalized)

    def test_adapter_reads_shared_token_from_environment(self):
        with patch.dict(os.environ, {"CHAOS_TOKEN": "runtime-secret"}, clear=False):
            adapter = module.TikTokAdapter("creator")
        self.assertEqual(adapter.token, "runtime-secret")

    def test_prefers_tiktok_order_id_for_replay_safe_event_id(self):
        event = SimpleNamespace(
            gift=SimpleNamespace(id=42, name="Rose"),
            user=SimpleNamespace(unique_id="viewer_1"), repeat_count=1, order_id="order-abc"
        )
        first = module.gift_to_event(event)
        second = module.gift_to_event(event)
        self.assertEqual(first["id"], "tiktok:order_id:order-abc")
        self.assertEqual(first["id"], second["id"])

    def test_registers_live_handlers_once_on_adapter_creation(self):
        adapter = module.TikTokAdapter("creator")
        self.assertTrue(adapter.client.has_listener(module.ConnectEvent))
        self.assertTrue(adapter.client.has_listener(module.DisconnectEvent))
        self.assertTrue(adapter.client.has_listener(module.LiveEndEvent))
        self.assertTrue(adapter.client.has_listener(module.GiftEvent))

class ConnectorAsyncTests(IsolatedAsyncioTestCase):
    async def test_refuses_to_connect_without_auth_token(self):
        with patch.dict(os.environ, {}, clear=True):
            adapter = module.TikTokAdapter("creator")
        with self.assertRaisesRegex(RuntimeError, "CHAOS_TOKEN is required"):
            await adapter.run_once()

    async def test_ignores_intermediate_streak_updates(self):
        adapter = module.TikTokAdapter("creator")
        sent = []

        async def capture(payload):
            sent.append(payload)

        adapter._send = capture
        event = SimpleNamespace(
            gift=SimpleNamespace(id=42, name="Rose"),
            user=SimpleNamespace(unique_id="viewer_1"), repeat_count=2, streaking=True,
        )
        await adapter._on_gift(event)
        self.assertEqual(sent, [])

    async def test_publishes_final_streak_count_once(self):
        adapter = module.TikTokAdapter("creator")
        sent = []

        async def capture(payload):
            sent.append(payload)

        adapter._send = capture
        event = SimpleNamespace(
            gift=SimpleNamespace(id=42, name="Rose"),
            user=SimpleNamespace(unique_id="viewer_1"), repeat_count=5, streaking=False,
        )
        await adapter._on_gift(event)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["quantity"], 5)

    async def test_publishes_live_ended_status(self):
        adapter = module.TikTokAdapter("creator")
        sent = []

        async def capture(message_type, payload):
            sent.append((message_type, payload))

        adapter._send_envelope = capture
        await adapter._on_live_end(module.LiveEndEvent())
        self.assertEqual(sent[0][0], "live.status")
        self.assertEqual(sent[0][1]["state"], "live_ended")

if __name__ == "__main__":
    unittest.main()
