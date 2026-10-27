import { createHash, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { PROTOCOL_VERSION, type ClientRole, type EffectCommand, type EffectConfig, type Envelope, isEnvelope, type OverlayConfig, type PerformanceConfig, type ServiceStatus } from "@gta-chaos/protocol";
import { GiftRuleEngine } from "./domain.js";
import { ChaosStorage } from "./storage.js";
import { ChaosMeter } from "./chaos.js";
import { isPerformanceProfile, performanceConfig } from "./performance.js";
import { applyEffectPolicies, sortEffectCommands } from "./effect-policy.js";

const port = Number(process.env.CHAOS_PORT ?? 39177);
const queue: EffectCommand[] = [];
const seen = new Map<string, number>();
let stopped = false;
let paused = false;
const rules = new GiftRuleEngine();
const storage = new ChaosStorage();
const chaos = new ChaosMeter();
const effectConfigs = new Map<string, EffectConfig>(storage.listEffects().map((effect) => [effect.id, effect]));
const defaultEffectConfigs: EffectConfig[] = [
  ["player.ragdoll", "Ragdoll", "PLAYER", 750],
  ["player.recover_health", "Recover health", "PLAYER", 0],
  ["player.invincibility", "Temporary invincibility", "PLAYER", 3000],
  ["player.super_jump", "Super jump", "PLAYER", 5000],
  ["player.speed_boost", "Speed boost", "PLAYER", 5000],
  ["player.change_weapon", "Change weapon", "PLAYER", 0],
  ["player.wanted_level", "Wanted level", "PLAYER", 0],
  ["player.clear_wanted", "Clear wanted level", "PLAYER", 0],
  ["player.remove_weapons", "Remove weapons", "PLAYER", 0],
  ["world.weather", "Weather shift", "WORLD", 10000],
  ["world.time", "Time shift", "WORLD", 10000],
  ["vehicle.spin", "Vehicle spin", "VEHICLE", 5000],
  ["vehicle.engine_off", "Engine off", "VEHICLE", 0],
].map(([id, name, category, duration]) => ({ id, name, description: `${name} effect`, category, defaultDurationMs: duration, intensity: 1, probability: 1, cooldownMs: 1000, priority: 0, compatibility: "both", updatedAt: new Date().toISOString() } as EffectConfig));
for (const effect of defaultEffectConfigs) {
  if (!effectConfigs.has(effect.id)) { storage.upsertEffect(effect); effectConfigs.set(effect.id, effect); }
}
const token = process.env.CHAOS_TOKEN;
if (!token) throw new Error("CHAOS_TOKEN is required; refusing to start the orchestrator without local authentication");
const authenticated = new WeakSet<WebSocket>();
const roles = new WeakMap<WebSocket, ClientRole>();
const sources = new WeakMap<WebSocket, string | undefined>();
const connectionIds = new WeakMap<WebSocket, string>();
const lastDiagnosticAt = new WeakMap<WebSocket, number>();
const alive = new WeakMap<WebSocket, boolean>();
const serviceStatus: ServiceStatus = { gta: "disconnected", tiktok: "disconnected", updatedAt: new Date().toISOString() };
const commandContext = new Map<string, { username?: string; giftName?: string; imageUrl?: string; quantity?: number; commandCreatedAt?: string }>();
const inFlight = new Map<string, { command: EffectCommand; attempts: number; dispatchedAt: number }>();
const dispatchAttempts = new Map<string, number>();
const terminalCommands = new Map<string, number>();
const maxDispatchAttempts = 3;
const stats = { sessionStartedAt: new Date().toISOString(), giftsReceived: 0, effectsQueued: 0, effectsSucceeded: 0, effectsFailed: 0, updatedAt: new Date().toISOString() };
const sessionId = randomUUID();
storage.startSession(sessionId, stats.sessionStartedAt);
function logEvent(level: "info" | "warn" | "error", event: string, message: string, correlationId?: string, metadata?: Record<string, unknown>) {
  const createdAt = new Date().toISOString();
  storage.recordLog({ level, event, message, sessionId, correlationId, metadata, createdAt });
  const serialized = JSON.stringify({ level, event, message, sessionId, correlationId, metadata: metadata ?? {}, createdAt });
  if (level === "error") console.error(serialized); else if (level === "warn") console.warn(serialized); else console.log(serialized);
}
function frameSha256(serialized: string) { return createHash("sha256").update(Buffer.from(serialized, "utf8")).digest("hex"); }
function sendFrame(socket: WebSocket, message: Envelope, connectionId: string, event = "protocol.frame.sent") {
  const serialized = JSON.stringify(message);
  const payload = message.payload as unknown;
  const correlationId = payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).id === "string" ? String((payload as Record<string, unknown>).id) : undefined;
  logEvent("info", event, "WebSocket frame sent", correlationId, { connectionId, bytes: Buffer.byteLength(serialized, "utf8"), sha256: frameSha256(serialized), type: message.type });
  socket.send(serialized);
}
function protocolFrameSummary(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { shape: Array.isArray(value) ? "array" : typeof value };
  const record = value as Record<string, unknown>;
  const payload = record.payload;
  const summary: Record<string, unknown> = { protocolVersion: record.protocolVersion, type: record.type, topLevelKeys: Object.keys(record) };
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    summary.payloadKeys = Object.keys(body);
    if (typeof body.id === "string") summary.id = body.id;
    if (typeof body.status === "string") summary.status = body.status;
    if (typeof body.effectId === "string") summary.effectId = body.effectId;
  } else summary.payloadShape = Array.isArray(payload) ? "array" : typeof payload;
  return summary;
}
function protocolRejectReason(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "envelope_not_record";
  const record = value as Record<string, unknown>;
  if (record.protocolVersion !== PROTOCOL_VERSION) return "protocol_version_invalid";
  if (typeof record.type !== "string") return "type_invalid";
  if (!("payload" in record)) return "payload_missing";
  if (record.type === "result") {
    const payload = record.payload as Record<string, unknown>;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "result_payload_not_record";
    if (typeof payload.id !== "string" || payload.id.length === 0) return "result_id_invalid";
    if (!["accepted", "succeeded", "rejected", "failed", "cancelled"].includes(String(payload.status))) return "result_status_invalid";
    if (typeof payload.createdAt !== "string" || Number.isNaN(Date.parse(payload.createdAt))) return "result_createdAt_invalid";
    for (const key of ["effectId", "username", "giftName", "imageUrl", "error"]) if (payload[key] !== undefined && typeof payload[key] !== "string") return `result_${key}_invalid`;
    if (payload.quantity !== undefined) {
      const quantity = payload.quantity;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) return "result_quantity_invalid";
    }
    if (payload.latencyMs !== undefined && (typeof payload.latencyMs !== "number" || !Number.isFinite(payload.latencyMs))) return "result_latency_invalid";
  }
  return "envelope_validation_failed";
}
logEvent("info", "orchestrator.started", "Orchestrator session started");
let overlayConfig: OverlayConfig = storage.getOverlayConfig() ?? { gameplayShare: 65, columns: 5, visibleCount: 20, compact: false, fontScale: 1, gap: 10, backgroundOpacity: 0.92, alertDurationMs: 4000, soundEnabled: true, iconScale: 1, cardBackground: "#272d22", cardBorder: "#5c694b" };
const savedPerformanceProfile = storage.getPerformanceProfile();
let performance: PerformanceConfig = performanceConfig(isPerformanceProfile(savedPerformanceProfile) ? savedPerformanceProfile : "balanced");
let latencyTotalMs = 0;
let latencySamples = 0;
function statsSnapshot() { return { ...stats, queueDepth: queue.length, activeEffects: commandContext.size, averageLatencyMs: latencySamples ? Math.round(latencyTotalMs / latencySamples) : 0 }; }
function sessionsSnapshot() { return storage.listSessions(); }
function touchStats() { stats.updatedAt = new Date().toISOString(); storage.updateSession(sessionId, stats); broadcast({ protocolVersion: PROTOCOL_VERSION, type: "sessions.snapshot", payload: sessionsSnapshot() }); broadcast({ protocolVersion: PROTOCOL_VERSION, type: "analytics.snapshot", payload: storage.getAnalyticsSnapshot() }); }
function publishServiceStatus() { serviceStatus.updatedAt = new Date().toISOString(); broadcast({ protocolVersion: PROTOCOL_VERSION, type: "service.status", payload: { ...serviceStatus } }); }
function effectSnapshot() { return [...effectConfigs.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)); }
function sortQueue() {
  queue.splice(0, queue.length, ...sortEffectCommands(queue, effectConfigs));
}
function rememberId(id: string) {
  const now = Date.now();
  for (const [knownId, timestamp] of seen) if (now - timestamp > 30 * 60_000) seen.delete(knownId);
  if (seen.has(id)) return false;
  if (seen.size >= 10_000) seen.delete(seen.keys().next().value!);
  seen.set(id, now);
  return true;
}
function rememberTerminal(id: string) {
  terminalCommands.set(id, Date.now());
  for (const [knownId, timestamp] of terminalCommands) if (Date.now() - timestamp > 30 * 60_000) terminalCommands.delete(knownId);
}
function rejectCommand(command: EffectCommand, error: string) {
  const context = commandContext.get(command.id);
  inFlight.delete(command.id);
  commandContext.delete(command.id);
  dispatchAttempts.delete(command.id);
  rememberTerminal(command.id);
  const createdAt = new Date().toISOString();
  stats.effectsFailed += 1;
  storage.recordEffectResult({ commandId: command.id, effectId: command.effectId, status: "rejected", error, createdAt });
  touchStats();
  broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: command.id, status: "rejected", effectId: command.effectId, error, username: context?.username, giftName: context?.giftName, imageUrl: context?.imageUrl, quantity: context?.quantity, createdAt } });
  broadcast({ protocolVersion: PROTOCOL_VERSION, type: "stats.snapshot", payload: statsSnapshot() });
}
function requeueInFlight(reason: string) {
  const now = Date.now();
  for (const [commandId, state] of inFlight) {
    inFlight.delete(commandId);
    if (Date.parse(state.command.expiresAt) <= now) rejectCommand(state.command, "expired");
    else if (state.attempts >= maxDispatchAttempts) rejectCommand(state.command, "gta_reconnect_retry_exhausted");
    else { queue.push(state.command); logEvent("warn", "effect.requeued", "Effect returned to queue after GTA disconnect", commandId, { reason, attempts: state.attempts }); }
  }
  sortQueue();
}
for (const gift of storage.listGifts(true)) rules.upsert(gift);

const wss = new WebSocketServer({ host: "127.0.0.1", port });
wss.on("error", (error) => logEvent("error", "websocket.server.error", "WebSocket server error", undefined, { type: error.constructor.name }));

function broadcast(message: Envelope) {
  for (const client of wss.clients) {
    const connectionId = connectionIds.get(client);
    if (connectionId && authenticated.has(client) && client.readyState === client.OPEN) sendFrame(client, message, connectionId, "protocol.broadcast.sent");
  }
}
function roleCanSend(role: ClientRole, type: string) {
  if (role === "dashboard") return ["system.stop", "system.pause", "system.resume", "catalog.upsert", "catalog.remove", "effect.upsert", "overlay.config", "performance.config", "gift.event", "effect.command"].includes(type);
  if (role === "simulator") return ["catalog.upsert", "gift.event"].includes(type);
  if (role === "tiktok") return ["gift.event", "live.status"].includes(type);
  if (role === "gta") return type === "result" || type === "transport.diagnostic";
  return false;
}

wss.on("connection", (socket) => {
  const connectionId = randomUUID();
  connectionIds.set(socket, connectionId);
  alive.set(socket, true);
  logEvent("info", "websocket.connection", "WebSocket connection accepted", undefined, { connectionId });
  socket.on("error", (error) => logEvent("error", "websocket.error", "WebSocket connection error", undefined, { connectionId, type: error.constructor.name }));
  socket.on("ping", () => logEvent("info", "websocket.ping", "WebSocket ping received", undefined, { connectionId }));
  socket.on("pong", () => { alive.set(socket, true); logEvent("info", "websocket.pong", "WebSocket pong received", undefined, { connectionId }); });
  socket.on("close", (code, reason) => {
    const role = roles.get(socket);
    const anotherClientHasRole = role && Array.from(wss.clients).some((client) => client !== socket && authenticated.has(client) && roles.get(client) === role);
    if (!anotherClientHasRole && role === "gta") { serviceStatus.gta = "disconnected"; delete serviceStatus.gtaSource; requeueInFlight("gta_disconnect"); }
    if (!anotherClientHasRole && (role === "tiktok" || role === "simulator")) serviceStatus.tiktok = "disconnected";
    logEvent("info", "client.disconnected", "Local client disconnected", undefined, { connectionId, role: role ?? "unknown", code, reason: reason.toString("utf8") });
    publishServiceStatus();
  });
  logEvent("info", "websocket.message.listener.ready", "WebSocket message listener attached", undefined, { connectionId });
  sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: randomUUID(), status: "rejected", error: "auth_required", createdAt: new Date().toISOString() } }, connectionId);
  socket.on("message", (raw) => {
    const rawText = raw.toString();
    const frameBytes = Buffer.byteLength(rawText, "utf8");
    const frameHash = frameSha256(rawText);
    logEvent("info", "websocket.message", "WebSocket message received", undefined, { connectionId, bytes: frameBytes, sha256: frameHash });
    let message: unknown;
    try {
      message = JSON.parse(rawText);
      logEvent("info", "protocol.frame.received", "WebSocket frame parsed", undefined, { connectionId, bytes: frameBytes, sha256: frameHash, ...protocolFrameSummary(message) });
    } catch {
      logEvent("warn", "protocol.frame.rejected", "WebSocket frame was not valid JSON", undefined, { connectionId, bytes: frameBytes, sha256: frameHash });
      return;
    }
    if (!isEnvelope(message)) {
      logEvent("warn", "protocol.frame.rejected", "WebSocket frame failed envelope validation", undefined, { connectionId, bytes: frameBytes, sha256: frameHash, reason: protocolRejectReason(message), ...protocolFrameSummary(message) });
      return;
    }
    logEvent("info", "protocol.frame.accepted", "WebSocket envelope accepted", typeof (message as any).payload?.id === "string" ? (message as any).payload.id : undefined, { connectionId, ...protocolFrameSummary(message) });
    if (message.type === "auth.hello") {
      if (authenticated.has(socket)) { logEvent("warn", "auth.replay", "Authenticated client attempted to renegotiate its role", undefined, { role: roles.get(socket) ?? "unknown" }); socket.close(1008, "auth_already_complete"); return; }
      if (message.payload.token !== token) { logEvent("warn", "auth.rejected", "Invalid local authentication token", undefined, { client: message.payload.client }); socket.close(1008, "invalid_token"); return; }
      authenticated.add(socket);
      roles.set(socket, message.payload.client ?? "dashboard");
      sources.set(socket, message.payload.source);
      logEvent("info", "auth.accepted", "Local client authenticated", undefined, { connectionId, client: message.payload.client, source: message.payload.source });
      if (message.payload.client === "gta") { serviceStatus.gta = "connected"; serviceStatus.gtaSource = message.payload.source; }
      if (message.payload.client === "tiktok" || message.payload.client === "simulator") serviceStatus.tiktok = "connected";
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: randomUUID(), status: "accepted", createdAt: new Date().toISOString() } }, connectionId);
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "catalog.snapshot", payload: rules.listAll() }, connectionId);
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "chaos.snapshot", payload: chaos.snapshot() }, connectionId);
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "stats.snapshot", payload: statsSnapshot() }, connectionId);
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "effects.snapshot", payload: effectSnapshot() }, connectionId);
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "overlay.config", payload: overlayConfig }, connectionId);
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "performance.config", payload: performance }, connectionId);
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "sessions.snapshot", payload: sessionsSnapshot() }, connectionId);
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "analytics.snapshot", payload: storage.getAnalyticsSnapshot() }, connectionId);
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "service.status", payload: { ...serviceStatus } }, connectionId);
      publishServiceStatus();
      return;
    }
    if (!authenticated.has(socket)) return;
    const role = roles.get(socket);
    if (!role || !roleCanSend(role, message.type)) {
      logEvent("warn", "client.message_forbidden", "Authenticated client role cannot send this message type", undefined, { connectionId, role: role ?? "unknown", type: message.type });
      return;
    }
    if (message.type === "transport.diagnostic") {
      if (role !== "gta" || sources.get(socket) !== "gta-mod") {
        logEvent("warn", "transport.diagnostic.rejected", "Diagnostic probe requires authenticated gta-mod", message.payload.id, { connectionId, role, source: sources.get(socket) ?? "unknown" });
        return;
      }
      if (frameBytes > 1024) {
        logEvent("warn", "transport.diagnostic.rejected", "Diagnostic probe frame too large", message.payload.id, { connectionId, bytes: frameBytes });
        return;
      }
      const now = Date.now();
      const previous = lastDiagnosticAt.get(socket) ?? 0;
      if (now - previous < 1000) {
        logEvent("warn", "transport.diagnostic.rejected", "Diagnostic probe rate limited", message.payload.id, { connectionId });
        return;
      }
      lastDiagnosticAt.set(socket, now);
      logEvent("info", "transport.diagnostic.received", "Authenticated transport diagnostic received", message.payload.id, { connectionId, sentAt: message.payload.sentAt });
      sendFrame(socket, { protocolVersion: PROTOCOL_VERSION, type: "transport.diagnostic.ack", payload: { id: message.payload.id, connectionId, receivedAt: new Date().toISOString() } }, connectionId);
      logEvent("info", "transport.diagnostic.acknowledged", "Transport diagnostic acknowledged", message.payload.id, { connectionId });
      return;
    }
    if (message.type === "system.stop") {
      logEvent("warn", "system.stop", "Emergency stop requested", undefined, { reason: message.payload.reason });
      stopped = true;
      paused = false;
      const cancelled = [...commandContext.entries()];
      queue.length = 0;
      inFlight.clear();
      dispatchAttempts.clear();
      commandContext.clear();
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "system.stop", payload: { reason: message.payload.reason } });
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "chaos.snapshot", payload: chaos.reset() });
      for (const [commandId, context] of cancelled) {
        rememberTerminal(commandId);
        const createdAt = new Date().toISOString();
        storage.recordEffectResult({ commandId, status: "cancelled", error: message.payload.reason, createdAt });
        broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: commandId, status: "cancelled", error: message.payload.reason, username: context.username, giftName: context.giftName, imageUrl: context.imageUrl, quantity: context.quantity, createdAt } });
      }
      touchStats();
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: randomUUID(), status: "cancelled", error: message.payload.reason, createdAt: new Date().toISOString() } });
      return;
    }
    if (message.type === "system.pause") { paused = true; broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: randomUUID(), status: "accepted", error: message.payload.reason ?? "paused", createdAt: new Date().toISOString() } }); return; }
    if (message.type === "system.resume") { stopped = false; paused = false; broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: randomUUID(), status: "accepted", createdAt: new Date().toISOString() } }); return; }
    if (message.type === "catalog.upsert") {
      rules.upsert(message.payload);
      storage.upsertGift(message.payload);
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "catalog.snapshot", payload: rules.listAll() });
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: message.payload.id, status: "accepted", createdAt: new Date().toISOString() } });
      return;
    }
    if (message.type === "catalog.remove") {
      rules.remove(message.payload.id);
      storage.removeGift(message.payload.id);
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "catalog.snapshot", payload: rules.listAll() });
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: message.payload.id, status: "accepted", createdAt: new Date().toISOString() } });
      return;
    }
    if (message.type === "effect.upsert") {
      effectConfigs.set(message.payload.id, message.payload);
      storage.upsertEffect(message.payload);
      sortQueue();
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "effects.snapshot", payload: effectSnapshot() });
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: message.payload.id, status: "accepted", effectId: message.payload.id, createdAt: new Date().toISOString() } });
      return;
    }
    if (message.type === "overlay.config") {
      overlayConfig = message.payload;
      storage.upsertOverlayConfig(overlayConfig);
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "overlay.config", payload: overlayConfig });
      return;
    }
    if (message.type === "performance.config") {
      performance = performanceConfig(message.payload.profile);
      storage.upsertPerformanceProfile(performance.profile);
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "performance.config", payload: performance });
      return;
    }
    if (message.type === "gift.event") {
      if (!rememberId(message.payload.id)) return;
      logEvent("info", "gift.received", "Gift event accepted for evaluation", message.payload.id, { username: message.payload.username, giftId: message.payload.giftId, quantity: message.payload.quantity });
      stats.giftsReceived += 1;
      storage.recordGiftEvent(message.payload);
      if (!rules.mergeGiftMetadata(message.payload.giftId, message.payload.giftName, message.payload.imageUrl, message.payload.coinCost, message.payload.costVerified)) {
        const pending = { id: message.payload.giftId, name: message.payload.giftName, imageUrl: message.payload.imageUrl,
          coinCost: message.payload.costVerified ? message.payload.coinCost : undefined,
          costVerified: message.payload.costVerified === true && typeof message.payload.coinCost === "number" && Number.isInteger(message.payload.coinCost) && message.payload.coinCost > 0,
          active: false, requiredQuantity: 1, effectIds: [], cooldownMs: 0, priority: 0 };
        rules.upsert(pending);
        storage.upsertGift(pending);
        broadcast({ protocolVersion: PROTOCOL_VERSION, type: "catalog.snapshot", payload: rules.listAll() });
      } else {
        const known = rules.listAll().find((gift) => gift.id === message.payload.giftId);
        if (known) { storage.upsertGift(known); broadcast({ protocolVersion: PROTOCOL_VERSION, type: "catalog.snapshot", payload: rules.listAll() }); }
      }
      const decision = rules.evaluate(message.payload);
      const policy = applyEffectPolicies(decision.commands, effectConfigs, message.payload, chaos.snapshot().level);
      decision.commands = policy.commands;
      if (decision.commands.length === 0 && policy.rejectedEffectIds.length > 0) {
        decision.status = "ignored";
        decision.reason = "effect_condition_failed";
      }
      if (queue.length + decision.commands.length > performance.queueLimit || commandContext.size + decision.commands.length > performance.maxActiveEffects) {
        decision.status = "queue_full";
        decision.reason = queue.length + decision.commands.length > performance.queueLimit ? "queue_full" : "performance_limit";
        decision.commands = [];
      }
      for (const command of decision.commands) { queue.push(command); commandContext.set(command.id, { username: message.payload.username, giftName: message.payload.giftName, imageUrl: message.payload.imageUrl, quantity: message.payload.quantity, commandCreatedAt: command.createdAt }); }
      sortQueue();
      stats.effectsQueued += decision.commands.length;
      touchStats();
      if (decision.status === "queued") broadcast({ protocolVersion: PROTOCOL_VERSION, type: "chaos.snapshot", payload: chaos.add(decision.commands.length * 5) });
      if (decision.status !== "queued") logEvent("warn", "gift.rejected", `Gift event rejected: ${decision.reason ?? decision.status}`, message.payload.id, { status: decision.status, reason: decision.reason, commands: decision.commands.length });
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: message.payload.id, status: decision.status === "queued" ? "accepted" : "rejected", username: message.payload.username, giftName: message.payload.giftName, quantity: message.payload.quantity, error: decision.reason, createdAt: new Date().toISOString() } });
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "stats.snapshot", payload: statsSnapshot() });
      return;
    }
    if (message.type === "result") {
      const pending = inFlight.has(message.payload.id) || commandContext.has(message.payload.id);
      logEvent("info", "effect.result.received", "Result received from authenticated client", message.payload.id, { connectionId, status: message.payload.status, effectId: message.payload.effectId, pending });
      if (terminalCommands.has(message.payload.id)) { logEvent("warn", "effect.result.duplicate", "Result ignored because command is already terminal", message.payload.id); return; }
      if (message.payload.status === "succeeded") stats.effectsSucceeded += 1;
      if (message.payload.status === "failed") stats.effectsFailed += 1;
      const context = commandContext.get(message.payload.id);
      if (context) commandContext.delete(message.payload.id);
      const latencyMs = context?.commandCreatedAt ? Math.max(0, Date.parse(message.payload.createdAt) - Date.parse(context.commandCreatedAt)) : undefined;
      if (latencyMs !== undefined) { latencyTotalMs += latencyMs; latencySamples += 1; }
      storage.recordEffectResult({ commandId: message.payload.id, effectId: message.payload.effectId, status: message.payload.status, error: message.payload.error, latencyMs, createdAt: message.payload.createdAt });
      logEvent("info", "effect.result.persisted", "Result persisted", message.payload.id, { connectionId, status: message.payload.status, latencyMs });
      inFlight.delete(message.payload.id);
      dispatchAttempts.delete(message.payload.id);
      rememberTerminal(message.payload.id);
      logEvent(message.payload.status === "failed" ? "error" : "info", "effect.result", `Effect command ${message.payload.status}`, message.payload.id, { connectionId, effectId: message.payload.effectId, latencyMs, error: message.payload.error });
      touchStats();
      const publicContext = context ? { username: context.username, giftName: context.giftName, imageUrl: context.imageUrl, quantity: context.quantity } : {};
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { ...message.payload, ...publicContext, latencyMs } });
      logEvent("info", "effect.result.published", "Final result published to authenticated clients", message.payload.id, { connectionId, status: message.payload.status, overlayEligible: true });
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "stats.snapshot", payload: statsSnapshot() });
      return;
    }
    if (message.type === "live.status") { serviceStatus.tiktok = message.payload.state === "connected" ? "connected" : message.payload.state; publishServiceStatus(); broadcast(message); return; }
    if (message.type !== "effect.command" || stopped || paused || !rememberId(message.payload.id)) return;
    if (queue.length >= performance.queueLimit) {
      broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: message.payload.id, status: "rejected", error: "queue_full", createdAt: new Date().toISOString() } });
      return;
    }
    queue.push(message.payload);
    sortQueue();
    broadcast({ protocolVersion: PROTOCOL_VERSION, type: "result", payload: { id: message.payload.id, status: "accepted", createdAt: new Date().toISOString() } });
  });
});

setInterval(() => {
  for (const client of wss.clients) {
    if (alive.get(client) === false) {
      const connectionId = connectionIds.get(client);
      logEvent("warn", "websocket.terminate", "WebSocket heartbeat expired; terminating connection", undefined, { connectionId });
      client.terminate();
      continue;
    }
    alive.set(client, false);
    logEvent("info", "websocket.ping.sent", "WebSocket ping sent", undefined, { connectionId: connectionIds.get(client) });
    client.ping();
  }
}, 15_000);

setInterval(() => {
  if (stopped || paused || serviceStatus.gta !== "connected" || queue.length === 0) return;
  const command = queue.shift()!;
  if (Date.parse(command.expiresAt) < Date.now()) {
    rejectCommand(command, "expired");
    return;
  }
  // The GTA adapter will claim this command when the mod connects.
  const attempts = (dispatchAttempts.get(command.id) ?? 0) + 1;
  dispatchAttempts.set(command.id, attempts);
  inFlight.set(command.id, { command, attempts, dispatchedAt: Date.now() });
  broadcast({ protocolVersion: PROTOCOL_VERSION, type: "effect.command", payload: command });
}, 50);

setInterval(() => {
  const now = Date.now();
  for (const state of inFlight.values()) {
    if (Date.parse(state.command.expiresAt) <= now) rejectCommand(state.command, "ack_timeout");
  }
}, 250);

// Publish decay even when no new gifts arrive so the dashboard and OBS overlay
// reflect the current Chaos Level instead of staying on a stale snapshot.
setInterval(() => {
  broadcast({ protocolVersion: PROTOCOL_VERSION, type: "chaos.snapshot", payload: chaos.snapshot() });
}, 1000);

function closeSession() {
  storage.finishSession(sessionId, stats);
  storage.close();
}
process.once("SIGINT", () => { closeSession(); process.exit(0); });
process.once("SIGTERM", () => { closeSession(); process.exit(0); });
process.once("exit", () => { try { storage.finishSession(sessionId, stats); storage.close(); } catch { /* process is already terminating */ } });

console.log(`GTA Chaos Live orchestrator listening on ws://127.0.0.1:${port}`);
