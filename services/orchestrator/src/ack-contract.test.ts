import test from "node:test";
import assert from "node:assert/strict";
import { isEnvelope } from "@gta-chaos/protocol";

test("accepts the exact succeeded result serialized by LocalCommandClient", () => {
  const raw = "{\"protocolVersion\":1,\"type\":\"result\",\"payload\":{" +
    "\"id\":\"fa6ce6ff-aedf-4217-b329-89d023cc53af\",\"effectId\":\"player.recover_health\",\"status\":\"succeeded\",\"createdAt\":\"2026-10-25T13:46:13.1764716Z\"}}";
  const message = JSON.parse(raw);
  assert.equal(isEnvelope(message), true);
  assert.equal(message.payload.id, "fa6ce6ff-aedf-4217-b329-89d023cc53af");
  assert.equal(message.payload.status, "succeeded");
});

test("rejects a result with an invalid status instead of treating it as an ACK", () => {
  const message = {
    protocolVersion: 1,
    type: "result",
    payload: { id: "command-id", effectId: "player.recover_health", status: "ok", createdAt: "2026-10-25T13:46:13.176Z" },
  };
  assert.equal(isEnvelope(message), false);
});
