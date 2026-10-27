import test from "node:test";
import assert from "node:assert/strict";
import { isEnvelope, PROTOCOL_VERSION } from "@gta-chaos/protocol";

test("rejects malformed protocol messages", () => {
  assert.equal(isEnvelope({ type: "effect.command", payload: {} }), false);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "effect.command", payload: {} }), false);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "gift.event", payload: { id: "x", username: "u", giftId: "g", giftName: "Gift", quantity: 0, createdAt: new Date().toISOString(), source: "simulator" } }), false);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "catalog.upsert", payload: { id: "g", name: "Gift", costVerified: true, active: true, requiredQuantity: 1, effectIds: [], cooldownMs: 0, priority: 1 } }), false);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "effect.upsert", payload: { id: "player.ragdoll", name: "Ragdoll", description: "x", category: "PLAYER", defaultDurationMs: 1000, intensity: 2, probability: 1, cooldownMs: 0, compatibility: "both", updatedAt: new Date().toISOString() } }), false);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "effect.command", payload: { id: "cmd", effectId: "player.ragdoll", parameters: {}, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() } }), true);
});

test("validates overlay layout bounds", () => {
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "overlay.config", payload: { gameplayShare: 65, columns: 5, visibleCount: 20, compact: false, fontScale: 1, gap: 10, backgroundOpacity: 0.92, alertDurationMs: 4000, soundEnabled: true, iconScale: 1, cardBackground: "#272d22", cardBorder: "#5c694b" } }), true);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "overlay.config", payload: { gameplayShare: 40, columns: 5, visibleCount: 20, compact: false, fontScale: 1, gap: 10, backgroundOpacity: 0.92, alertDurationMs: 4000, soundEnabled: true, iconScale: 1, cardBackground: "#272d22", cardBorder: "#5c694b" } }), false);
});

test("validates performance profile limits", () => {
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "performance.config", payload: { profile: "balanced", queueLimit: 100, maxActiveEffects: 24 } }), true);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "performance.config", payload: { profile: "balanced", queueLimit: 1000, maxActiveEffects: 24 } }), false);
});

test("accepts safe effect metadata and rejects executable-shaped values", () => {
  const base = { id: "player.ragdoll", name: "Ragdoll", description: "x", category: "PLAYER", defaultDurationMs: 1000, intensity: 1, probability: 1, cooldownMs: 0, compatibility: "both", updatedAt: new Date().toISOString() };
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "effect.upsert", payload: { ...base, parameters: { durationMs: 1200, profile: "safe" }, conditions: { wantedLevel: { min: 0, max: 5 }, tags: ["story"] } } }), true);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "effect.upsert", payload: { ...base, parameters: { execute: () => true } } }), false);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "effect.upsert", payload: { ...base, conditions: [] } }), false);
});

test("validates explicit catalog removal messages", () => {
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "catalog.remove", payload: { id: "rose" } }), true);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "catalog.remove", payload: { id: "" } }), false);
});

test("accepts bounded manual image data and rejects arbitrary data URLs", () => {
  const base = { id: "rose", name: "Rose", costVerified: false, active: true, requiredQuantity: 1, effectIds: [], cooldownMs: 0, priority: 1 };
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "catalog.upsert", payload: { ...base, imageUrl: "data:image/png;base64,AAAA" } }), true);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "catalog.upsert", payload: { ...base, imageUrl: "data:text/html;base64,PGh0bWw+" } }), false);
});

test("validates non-negative effect priorities", () => {
  const base = { id: "player.ragdoll", name: "Ragdoll", description: "x", category: "PLAYER", defaultDurationMs: 1000, intensity: 1, probability: 1, cooldownMs: 0, compatibility: "both", updatedAt: new Date().toISOString() };
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "effect.upsert", payload: { ...base, priority: 10 } }), true);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "effect.upsert", payload: { ...base, priority: -1 } }), false);
});

test("validates persistent analytics snapshots", () => {
  const payload = { gifts: { Rose: 2 }, effects: { "player.ragdoll": 1 }, users: { viewer: 2 }, averageLatencyMs: 45, updatedAt: new Date().toISOString() };
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "analytics.snapshot", payload }), true);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "analytics.snapshot", payload: { ...payload, users: { viewer: -1 } } }), false);
});

test("validates authenticated transport diagnostic messages", () => {
  const sentAt = new Date().toISOString();
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "transport.diagnostic", payload: { id: "probe-1", sentAt } }), true);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "transport.diagnostic", payload: { id: "", sentAt } }), false);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "transport.diagnostic", payload: { id: "probe-1", sentAt: "not-a-date" } }), false);
});

test("validates transport diagnostic acknowledgements", () => {
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "transport.diagnostic.ack", payload: { id: "probe-1", connectionId: "connection-1", receivedAt: new Date().toISOString() } }), true);
  assert.equal(isEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "transport.diagnostic.ack", payload: { id: "probe-1", connectionId: "", receivedAt: new Date().toISOString() } }), false);
});
