import test from "node:test";
import assert from "node:assert/strict";
import { GiftRuleEngine, sortGiftCatalog, type GiftDefinition } from "./domain.js";
import type { EffectConfig, GiftEvent } from "@gta-chaos/protocol";
import { applyEffectPolicies, effectConditionMatches, sortEffectCommands } from "./effect-policy.js";

const gift = (overrides: Partial<GiftDefinition> = {}): GiftDefinition => ({
  id: "rose", name: "Rosa", coinCost: 1, costVerified: true, active: true,
  requiredQuantity: 1, effectIds: ["player.ragdoll"], cooldownMs: 1000, priority: 1, ...overrides,
});

const event: GiftEvent = { id: "evt-1", username: "viewer", giftId: "rose", giftName: "Rosa", quantity: 1, createdAt: new Date(0).toISOString(), source: "simulator" };

test("sorts verified costs first and leaves unknown prices pending", () => {
  const result = sortGiftCatalog([gift({ id: "unknown", name: "Pendiente", costVerified: false, coinCost: undefined }), gift({ id: "ten", name: "Diez", coinCost: 10 }), gift()]);
  assert.deepEqual(result.map((item) => item.id), ["rose", "ten", "unknown"]);
});

test("deduplicates cooldown-triggered effects", () => {
  const engine = new GiftRuleEngine(); engine.upsert(gift());
  assert.equal(engine.evaluate(event, 1000).status, "queued");
  assert.equal(engine.evaluate({ ...event, id: "evt-2" }, 1500).status, "cooldown");
  assert.equal(engine.evaluate({ ...event, id: "evt-3" }, 2001).status, "queued");
});

test("requires configured quantity before creating a command", () => {
  const engine = new GiftRuleEngine(); engine.upsert(gift({ requiredQuantity: 5 }));
  assert.equal(engine.evaluate(event).status, "ignored");
  assert.equal(engine.evaluate({ ...event, quantity: 5 }).commands.length, 1);
});

test("creates one command for each configured effect", () => {
  const engine = new GiftRuleEngine();
  engine.upsert(gift({ effectIds: ["player.ragdoll", "player.wanted_level"] }));
  const decision = engine.evaluate(event, 5000);
  assert.equal(decision.status, "queued");
  assert.deepEqual(decision.commands.map((command) => command.effectId), ["player.ragdoll", "player.wanted_level"]);
});

test("applies declarative conditions and parameters to queued commands", () => {
  const engine = new GiftRuleEngine(); engine.upsert(gift({ effectIds: ["player.ragdoll"] }));
  const config = { id: "player.ragdoll", name: "Ragdoll", description: "x", category: "PLAYER", defaultDurationMs: 750, intensity: 1, probability: 1, cooldownMs: 0, parameters: { durationMs: 1400 }, conditions: { minChaosLevel: 2, allowedSources: ["simulator"] }, compatibility: "both" as const, updatedAt: new Date().toISOString() };
  assert.equal(effectConditionMatches(config, event, 1), false);
  const decision = engine.evaluate(event, 5000);
  const applied = applyEffectPolicies(decision.commands, new Map([[config.id, config]]), event, 3);
  assert.deepEqual(applied.rejectedEffectIds, []);
  assert.equal(applied.commands[0]?.parameters.durationMs, 1400);
});

test("sorts queued commands by configured priority while preserving FIFO ties", () => {
  const commands = [
    { id: "low", effectId: "low", parameters: {}, createdAt: new Date(1000).toISOString(), expiresAt: new Date(2000).toISOString() },
    { id: "high", effectId: "high", parameters: {}, createdAt: new Date(1100).toISOString(), expiresAt: new Date(2000).toISOString() },
    { id: "tie", effectId: "low", parameters: {}, createdAt: new Date(1200).toISOString(), expiresAt: new Date(2000).toISOString() },
  ];
  const configs = new Map<string, Pick<EffectConfig, "priority">>([["low", { priority: 1 }], ["high", { priority: 10 }]]);
  assert.deepEqual(sortEffectCommands(commands, configs).map((command) => command.id), ["high", "low", "tie"]);
});

test("applies effect probability and default duration to gift commands", () => {
  const engine = new GiftRuleEngine(); engine.upsert(gift());
  const config = { id: "player.ragdoll", name: "Ragdoll", description: "x", category: "PLAYER", defaultDurationMs: 1400, intensity: 1, probability: 0.5, cooldownMs: 0, compatibility: "both" as const, updatedAt: new Date().toISOString() };
  const rejected = applyEffectPolicies(engine.evaluate(event, 6000).commands, new Map([[config.id, config]]), event, 0, () => 0.75);
  assert.equal(rejected.commands.length, 0);
  engine.upsert(gift());
  const accepted = applyEffectPolicies(engine.evaluate(event, 7000).commands, new Map([[config.id, config]]), event, 0, () => 0.25);
  assert.equal(accepted.commands[0]?.parameters.durationMs, 1400);
});
