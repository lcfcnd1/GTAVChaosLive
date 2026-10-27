import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { ChaosStorage } from "./storage.js";
import { exportProfile, importProfile } from "./profile-cli.js";
import type { EffectConfig } from "@gta-chaos/protocol";
import type { OverlayConfig } from "@gta-chaos/protocol";

test("persists and reloads gift definitions", () => {
  const path = "data/test-chaos-live.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  storage.upsertGift({ id: "pending", name: "Pending", costVerified: false, active: true, requiredQuantity: 1, effectIds: ["player.ragdoll"], cooldownMs: 1000, priority: 1 });
  storage.upsertGift({ id: "cheap", name: "Cheap", coinCost: 1, costVerified: true, active: true, requiredQuantity: 1, effectIds: [], cooldownMs: 0, priority: 0 });
  assert.deepEqual(storage.listGifts().map((gift) => gift.id), ["cheap", "pending"]);
  storage.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true });
});

test("removes a gift from persistent catalog", () => {
  const path = "data/test-chaos-live-remove-gift.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  storage.upsertGift({ id: "remove-me", name: "Remove me", costVerified: false, active: true, requiredQuantity: 1, effectIds: [], cooldownMs: 0, priority: 0 });
  storage.removeGift("remove-me");
  assert.deepEqual(storage.listGifts(true), []);
  storage.close();
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) rmSync(candidate, { force: true });
});

test("creates a consistent SQLite backup", () => {
  const path = "data/test-chaos-live-backup.db"; const backup = "data/test-chaos-live-backup-copy.db";
  rmSync(path, { force: true }); rmSync(backup, { force: true });
  const storage = new ChaosStorage(path);
  storage.upsertGift({ id: "backup-gift", name: "Backup", costVerified: false, active: true, requiredQuantity: 1, effectIds: [], cooldownMs: 0, priority: 0 });
  storage.backup(backup);
  const copy = new ChaosStorage(backup);
  assert.equal(copy.listGifts()[0]?.id, "backup-gift");
  copy.close(); storage.close();
  for (const candidate of [path, backup, `${path}-wal`, `${path}-shm`, `${backup}-wal`, `${backup}-shm`]) rmSync(candidate, { force: true });
});

test("persists and reloads effect configuration", () => {
  const path = "data/test-chaos-live-effects.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  const effect: EffectConfig = { id: "player.ragdoll", name: "Ragdoll custom", description: "Safe player fall", category: "PLAYER", defaultDurationMs: 1250, intensity: 0.75, probability: 1, cooldownMs: 500, compatibility: "both", updatedAt: new Date().toISOString() };
  storage.upsertEffect(effect);
  assert.deepEqual(storage.listEffects(), [effect]);
  storage.close();
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) rmSync(candidate, { force: true });
});

test("persists structured effect parameters and conditions", () => {
  const path = "data/test-chaos-live-effect-metadata.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  const effect: EffectConfig = { id: "player.wanted_level", name: "Wanted", description: "Controlled wanted level", category: "PLAYER", defaultDurationMs: 0, intensity: 1, probability: 1, cooldownMs: 500, priority: 7, parameters: { level: 3, mode: "temporary" }, conditions: { minChaosLevel: 1, allowedModes: ["story"] }, compatibility: "both", updatedAt: new Date().toISOString() };
  storage.upsertEffect(effect);
  assert.deepEqual(storage.listEffects(), [effect]);
  storage.close();
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) rmSync(candidate, { force: true });
});

test("persists session statistics and effect results", () => {
  const path = "data/test-chaos-live-sessions.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  storage.startSession("session-1", "2026-10-24T00:00:00.000Z");
  storage.updateSession("session-1", { giftsReceived: 3, effectsQueued: 4, effectsSucceeded: 2, effectsFailed: 1 });
  storage.recordEffectResult({ commandId: "command-1", effectId: "player.ragdoll", status: "succeeded", latencyMs: 42, createdAt: "2026-10-24T00:00:01.000Z" });
  storage.finishSession("session-1", { giftsReceived: 3, effectsQueued: 4, effectsSucceeded: 2, effectsFailed: 1 }, "2026-10-24T00:01:00.000Z");
  assert.equal(storage.countSessions(), 1);
  assert.deepEqual(storage.listEffectResults(), [{ commandId: "command-1", effectId: "player.ragdoll", status: "succeeded", error: null, latencyMs: 42, createdAt: "2026-10-24T00:00:01.000Z" }]);
  storage.close();
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) rmSync(candidate, { force: true });
});

test("persists structured logs with correlation and metadata", () => {
  const path = "data/test-chaos-live-logs.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  storage.recordLog({ level: "warn", event: "gift.rejected", message: "queue full", sessionId: "session-logs", correlationId: "gift-1", metadata: { queueDepth: 32 }, createdAt: "2026-10-24T00:00:00.000Z" });
  assert.deepEqual(storage.listLogs(1), [{ id: 1, level: "warn", event: "gift.rejected", message: "queue full", sessionId: "session-logs", correlationId: "gift-1", metadata: { queueDepth: 32 }, createdAt: "2026-10-24T00:00:00.000Z" }]);
  storage.close();
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) rmSync(candidate, { force: true });
});

test("aggregates persistent analytics from gifts and successful effects", () => {
  const path = "data/test-chaos-live-analytics.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  const base = { createdAt: "2026-10-24T00:00:00.000Z", source: "simulator" as const };
  storage.recordGiftEvent({ ...base, id: "gift-1", username: "alice", giftId: "rose", giftName: "Rose", quantity: 1 });
  storage.recordGiftEvent({ ...base, id: "gift-2", username: "alice", giftId: "rose", giftName: "Rose", quantity: 1 });
  storage.recordEffectResult({ commandId: "cmd-1", effectId: "player.ragdoll", status: "succeeded", latencyMs: 40, createdAt: base.createdAt });
  storage.recordEffectResult({ commandId: "cmd-2", effectId: "player.ragdoll", status: "failed", latencyMs: 100, createdAt: base.createdAt });
  const analytics = storage.getAnalyticsSnapshot();
  assert.deepEqual(analytics.gifts, { Rose: 2 });
  assert.deepEqual(analytics.effects, { "player.ragdoll": 1 });
  assert.deepEqual(analytics.users, { alice: 2 });
  assert.equal(analytics.averageLatencyMs, 40);
  storage.close();
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) rmSync(candidate, { force: true });
});

test("persists overlay layout configuration", () => {
  const path = "data/test-chaos-live-overlay.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  const config: OverlayConfig = { gameplayShare: 70, columns: 6, visibleCount: 30, compact: true, fontScale: 0.9, gap: 6, backgroundOpacity: 0.8, alertDurationMs: 5500, soundEnabled: false, iconScale: 1.2, cardBackground: "#101820", cardBorder: "#b8ff39" };
  storage.upsertOverlayConfig(config);
  assert.deepEqual(storage.getOverlayConfig(), config);
  storage.close();
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) rmSync(candidate, { force: true });
});

test("persists performance profile selection", () => {
  const path = "data/test-chaos-live-performance.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  storage.upsertPerformanceProfile("low");
  assert.equal(storage.getPerformanceProfile(), "low");
  storage.close();
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) rmSync(candidate, { force: true });
});

test("lists session summaries with real counters", () => {
  const path = "data/test-chaos-live-session-list.db"; rmSync(path, { force: true });
  const storage = new ChaosStorage(path);
  storage.startSession("session-history", "2026-10-24T00:00:00.000Z");
  storage.finishSession("session-history", { giftsReceived: 5, effectsQueued: 4, effectsSucceeded: 3, effectsFailed: 1 }, "2026-10-24T00:02:00.000Z");
  assert.deepEqual(storage.listSessions(), [{ id: "session-history", startedAt: "2026-10-24T00:00:00.000Z", endedAt: "2026-10-24T00:02:00.000Z", giftsReceived: 5, effectsQueued: 4, effectsSucceeded: 3, effectsFailed: 1, updatedAt: "2026-10-24T00:02:00.000Z" }]);
  storage.close();
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) rmSync(candidate, { force: true });
});

test("exports and imports gifts plus effects, while accepting legacy profiles", async () => {
  const sourcePath = "data/test-chaos-live-profile-source.db";
  const targetPath = "data/test-chaos-live-profile-target.db";
  const profilePath = "data/test-chaos-live-profile.json";
  const legacyPath = "data/test-chaos-live-profile-v1.json";
  for (const candidate of [sourcePath, targetPath, profilePath, legacyPath]) rmSync(candidate, { force: true });

  const source = new ChaosStorage(sourcePath);
  source.upsertGift({ id: "rose", name: "Rose", coinCost: 1, costVerified: true, active: true, requiredQuantity: 1, effectIds: ["player.ragdoll"], cooldownMs: 0, priority: 0 });
  const effect: EffectConfig = { id: "player.ragdoll", name: "Ragdoll", description: "Safe fall", category: "PLAYER", defaultDurationMs: 800, intensity: 1, probability: 1, cooldownMs: 0, compatibility: "both", updatedAt: new Date().toISOString() };
  source.upsertEffect(effect);
  await exportProfile(source, profilePath);
  source.close();

  const target = new ChaosStorage(targetPath);
  assert.deepEqual(await importProfile(target, profilePath), { gifts: 1, effects: 1 });
  assert.equal(target.listGifts()[0]?.id, "rose");
  assert.deepEqual(target.listEffects(), [effect]);
  target.close();

  await writeFile(legacyPath, JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), gifts: [] }), "utf8");
  const legacyTargetPath = `${targetPath}-legacy`;
  const legacyTarget = new ChaosStorage(legacyTargetPath);
  assert.deepEqual(await importProfile(legacyTarget, legacyPath), { gifts: 0, effects: 0 });
  legacyTarget.close();
  for (const candidate of [sourcePath, targetPath, profilePath, legacyPath, legacyTargetPath, `${legacyTargetPath}-wal`, `${legacyTargetPath}-shm`, `${targetPath}-wal`, `${targetPath}-shm`]) rmSync(candidate, { force: true });
});
