export const PROTOCOL_VERSION = 1 as const;

export type GiftEvent = {
  id: string;
  username: string;
  giftId: string;
  giftName: string;
  quantity: number;
  createdAt: string;
  source: "tiktok" | "simulator";
  imageUrl?: string;
  coinCost?: number;
  costVerified?: boolean;
};

export type EffectCommand = {
  id: string;
  effectId: string;
  parameters: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
};

export type ResultMessage = {
  id: string;
  status: "accepted" | "succeeded" | "rejected" | "failed" | "cancelled";
  effectId?: string;
  username?: string;
  giftName?: string;
  imageUrl?: string;
  quantity?: number;
  latencyMs?: number;
  error?: string;
  createdAt: string;
};

export type CatalogUpsert = {
  id: string;
  name: string;
  imageUrl?: string;
  coinCost?: number;
  costVerified: boolean;
  active: boolean;
  requiredQuantity: number;
  effectIds: string[];
  cooldownMs: number;
  priority: number;
};

export type EffectConfig = {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultDurationMs: number;
  intensity: number;
  probability: number;
  cooldownMs: number;
  priority?: number;
  parameters?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  compatibility: "legacy" | "enhanced" | "both";
  updatedAt: string;
};

export type ChaosSnapshot = { points: number; level: 0 | 1 | 2 | 3 | 4 | 5; updatedAt: number };
export type StatsSnapshot = { sessionStartedAt: string; giftsReceived: number; effectsQueued: number; effectsSucceeded: number; effectsFailed: number; queueDepth?: number; activeEffects?: number; averageLatencyMs?: number; updatedAt: string };
export type LiveStatus = { state: "connected" | "disconnected" | "live_ended"; source: "tiktok" | "simulator"; updatedAt: string };
export type ClientRole = "dashboard" | "gta" | "tiktok" | "simulator" | "overlay";
export type RuntimeSource = "gta-mod" | "mock-gta";
export type TransportDiagnostic = { id: string; sentAt: string };
export type TransportDiagnosticAck = { id: string; connectionId: string; receivedAt: string };
export type ServiceStatus = { gta: "connected" | "disconnected"; gtaSource?: RuntimeSource; tiktok: "connected" | "disconnected" | "live_ended"; updatedAt: string };
export type OverlayConfig = { gameplayShare: number; columns: 4 | 5 | 6; visibleCount: number; compact: boolean; fontScale: number; gap: number; backgroundOpacity: number; alertDurationMs: number; soundEnabled: boolean; iconScale: number; cardBackground: string; cardBorder: string };
export type PerformanceProfile = "low" | "balanced" | "high";
export type PerformanceConfig = { profile: PerformanceProfile; queueLimit: number; maxActiveEffects: number };
export type SessionSummary = { id: string; startedAt: string; endedAt?: string; giftsReceived: number; effectsQueued: number; effectsSucceeded: number; effectsFailed: number; updatedAt: string };
export type AnalyticsSnapshot = { gifts: Record<string, number>; effects: Record<string, number>; users: Record<string, number>; averageLatencyMs: number; updatedAt: string };

export type Envelope =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "auth.hello"; payload: { token: string; client?: ClientRole; source?: RuntimeSource } }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "gift.event"; payload: GiftEvent }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "effect.command"; payload: EffectCommand }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "result"; payload: ResultMessage }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "transport.diagnostic"; payload: TransportDiagnostic }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "transport.diagnostic.ack"; payload: TransportDiagnosticAck }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "catalog.upsert"; payload: CatalogUpsert }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "catalog.remove"; payload: { id: string } }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "catalog.snapshot"; payload: CatalogUpsert[] }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "effect.upsert"; payload: EffectConfig }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "effects.snapshot"; payload: EffectConfig[] }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "chaos.snapshot"; payload: ChaosSnapshot }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "stats.snapshot"; payload: StatsSnapshot }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "live.status"; payload: LiveStatus }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "service.status"; payload: ServiceStatus }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "overlay.config"; payload: OverlayConfig }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "performance.config"; payload: PerformanceConfig }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "sessions.snapshot"; payload: SessionSummary[] }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "analytics.snapshot"; payload: AnalyticsSnapshot }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "system.stop"; payload: { reason: string } }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "system.pause"; payload: { reason?: string } }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "system.resume"; payload: { reason?: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function isBoundedString(value: unknown, maxLength: number): value is string { return isString(value) && value.length <= maxLength; }
function isTimestamp(value: unknown): value is string { return isString(value) && !Number.isNaN(Date.parse(value)); }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isPositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value > 0; }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every(isString); }
function isHexColor(value: unknown): value is string { return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value); }
function isImageReference(value: unknown): value is string {
  if (!isString(value) || value.length > 700_000) return false;
  if (/^https?:\/\//i.test(value)) return true;
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value);
}
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isGiftEvent(value: unknown): value is GiftEvent {
  if (!isRecord(value) || !isString(value.id) || !isString(value.username) || !isString(value.giftId) || !isString(value.giftName) || !isPositiveInteger(value.quantity) || !isTimestamp(value.createdAt) || (value.source !== "tiktok" && value.source !== "simulator")) return false;
  if (value.imageUrl !== undefined && !isImageReference(value.imageUrl)) return false;
  if (value.coinCost !== undefined && !isPositiveInteger(value.coinCost)) return false;
  return value.costVerified === undefined || typeof value.costVerified === "boolean";
}

function isEffectCommand(value: unknown): value is EffectCommand {
  return isRecord(value) && isString(value.id) && isString(value.effectId) && isRecord(value.parameters) && isTimestamp(value.createdAt) && isTimestamp(value.expiresAt);
}

function isResultMessage(value: unknown): value is ResultMessage {
  if (!isRecord(value) || !isString(value.id) || !["accepted", "succeeded", "rejected", "failed", "cancelled"].includes(String(value.status)) || !isTimestamp(value.createdAt)) return false;
  for (const key of ["effectId", "username", "giftName", "imageUrl", "error"]) if (value[key] !== undefined && !isString(value[key])) return false;
  if (value.quantity !== undefined && !isPositiveInteger(value.quantity)) return false;
  return value.latencyMs === undefined || isFiniteNumber(value.latencyMs);
}
function isTransportDiagnostic(value: unknown): value is TransportDiagnostic {
  return isRecord(value) && isBoundedString(value.id, 64) && isTimestamp(value.sentAt);
}
function isTransportDiagnosticAck(value: unknown): value is TransportDiagnosticAck {
  return isRecord(value) && isBoundedString(value.id, 64) && isBoundedString(value.connectionId, 64) && isTimestamp(value.receivedAt);
}

function isCatalogUpsert(value: unknown): value is CatalogUpsert {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name) || ![true, false].includes(value.costVerified as boolean) || typeof value.active !== "boolean" || !isPositiveInteger(value.requiredQuantity) || !isStringArray(value.effectIds) || !isNonNegativeInteger(value.cooldownMs) || !isNonNegativeInteger(value.priority)) return false;
  if (value.imageUrl !== undefined && !isImageReference(value.imageUrl)) return false;
  if (value.coinCost !== undefined && !isPositiveInteger(value.coinCost)) return false;
  return !value.costVerified || isPositiveInteger(value.coinCost);
}
function isCatalogRemove(value: unknown): value is { id: string } { return isRecord(value) && isString(value.id); }

export function isEffectConfig(value: unknown): value is EffectConfig {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.description) && isString(value.category) && isNonNegativeInteger(value.defaultDurationMs) && isFiniteNumber(value.intensity) && value.intensity >= 0 && value.intensity <= 1 && isFiniteNumber(value.probability) && value.probability >= 0 && value.probability <= 1 && isNonNegativeInteger(value.cooldownMs) && (value.priority === undefined || isNonNegativeInteger(value.priority)) && (value.parameters === undefined || isJsonObject(value.parameters)) && (value.conditions === undefined || isJsonObject(value.conditions)) && ["legacy", "enhanced", "both"].includes(String(value.compatibility)) && isTimestamp(value.updatedAt);
}

function isChaosSnapshot(value: unknown): value is ChaosSnapshot { return isRecord(value) && isFiniteNumber(value.points) && typeof value.level === "number" && Number.isInteger(value.level) && value.level >= 0 && value.level <= 5 && isFiniteNumber(value.updatedAt); }
function isStatsSnapshot(value: unknown): value is StatsSnapshot { return isRecord(value) && isTimestamp(value.sessionStartedAt) && isNonNegativeInteger(value.giftsReceived) && isNonNegativeInteger(value.effectsQueued) && isNonNegativeInteger(value.effectsSucceeded) && isNonNegativeInteger(value.effectsFailed) && (value.queueDepth === undefined || isNonNegativeInteger(value.queueDepth)) && (value.activeEffects === undefined || isNonNegativeInteger(value.activeEffects)) && (value.averageLatencyMs === undefined || isFiniteNumber(value.averageLatencyMs)) && isTimestamp(value.updatedAt); }
function isLiveStatus(value: unknown): value is LiveStatus { return isRecord(value) && ["connected", "disconnected", "live_ended"].includes(String(value.state)) && ["tiktok", "simulator"].includes(String(value.source)) && isTimestamp(value.updatedAt); }
function isServiceStatus(value: unknown): value is ServiceStatus { return isRecord(value) && ["connected", "disconnected"].includes(String(value.gta)) && (value.gtaSource === undefined || ["gta-mod", "mock-gta"].includes(String(value.gtaSource))) && ["connected", "disconnected", "live_ended"].includes(String(value.tiktok)) && isTimestamp(value.updatedAt); }
function isOverlayConfig(value: unknown): value is OverlayConfig { return isRecord(value) && isFiniteNumber(value.gameplayShare) && value.gameplayShare >= 55 && value.gameplayShare <= 75 && [4, 5, 6].includes(Number(value.columns)) && isFiniteNumber(value.visibleCount) && Number.isInteger(value.visibleCount) && value.visibleCount >= 1 && value.visibleCount <= 30 && typeof value.compact === "boolean" && isFiniteNumber(value.fontScale) && value.fontScale >= 0.75 && value.fontScale <= 1.25 && isFiniteNumber(value.gap) && Number.isInteger(value.gap) && value.gap >= 0 && value.gap <= 20 && isFiniteNumber(value.backgroundOpacity) && value.backgroundOpacity >= 0 && value.backgroundOpacity <= 1 && isFiniteNumber(value.alertDurationMs) && Number.isInteger(value.alertDurationMs) && value.alertDurationMs >= 1000 && value.alertDurationMs <= 10000 && typeof value.soundEnabled === "boolean" && isFiniteNumber(value.iconScale) && value.iconScale >= 0.75 && value.iconScale <= 1.5 && isHexColor(value.cardBackground) && isHexColor(value.cardBorder); }
function isPerformanceConfig(value: unknown): value is PerformanceConfig { return isRecord(value) && ["low", "balanced", "high"].includes(String(value.profile)) && isPositiveInteger(value.queueLimit) && value.queueLimit <= 120 && isPositiveInteger(value.maxActiveEffects) && value.maxActiveEffects <= 48; }
function isSessionSummary(value: unknown): value is SessionSummary { return isRecord(value) && isString(value.id) && isTimestamp(value.startedAt) && (value.endedAt === undefined || isTimestamp(value.endedAt)) && isNonNegativeInteger(value.giftsReceived) && isNonNegativeInteger(value.effectsQueued) && isNonNegativeInteger(value.effectsSucceeded) && isNonNegativeInteger(value.effectsFailed) && isTimestamp(value.updatedAt); }
function isCountRecord(value: unknown): value is Record<string, number> { return isRecord(value) && Object.values(value).every(isNonNegativeInteger); }
function isAnalyticsSnapshot(value: unknown): value is AnalyticsSnapshot { return isRecord(value) && isCountRecord(value.gifts) && isCountRecord(value.effects) && isCountRecord(value.users) && isFiniteNumber(value.averageLatencyMs) && isTimestamp(value.updatedAt); }

export function isEnvelope(value: unknown): value is Envelope {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || typeof value.type !== "string" || !("payload" in value)) return false;
  switch (value.type) {
    case "auth.hello": return isRecord(value.payload) && isString(value.payload.token) && (value.payload.client === undefined || ["dashboard", "gta", "tiktok", "simulator", "overlay"].includes(String(value.payload.client))) && (value.payload.source === undefined || ["gta-mod", "mock-gta"].includes(String(value.payload.source)));
    case "gift.event": return isGiftEvent(value.payload);
    case "effect.command": return isEffectCommand(value.payload);
    case "result": return isResultMessage(value.payload);
    case "transport.diagnostic": return isTransportDiagnostic(value.payload);
    case "transport.diagnostic.ack": return isTransportDiagnosticAck(value.payload);
    case "catalog.upsert": return isCatalogUpsert(value.payload);
    case "catalog.remove": return isCatalogRemove(value.payload);
    case "catalog.snapshot": return Array.isArray(value.payload) && value.payload.every(isCatalogUpsert);
    case "effect.upsert": return isEffectConfig(value.payload);
    case "effects.snapshot": return Array.isArray(value.payload) && value.payload.every(isEffectConfig);
    case "chaos.snapshot": return isChaosSnapshot(value.payload);
    case "stats.snapshot": return isStatsSnapshot(value.payload);
    case "live.status": return isLiveStatus(value.payload);
    case "service.status": return isServiceStatus(value.payload);
    case "overlay.config": return isOverlayConfig(value.payload);
    case "performance.config": return isPerformanceConfig(value.payload);
    case "sessions.snapshot": return Array.isArray(value.payload) && value.payload.every(isSessionSummary);
    case "analytics.snapshot": return isAnalyticsSnapshot(value.payload);
    case "system.stop": return isRecord(value.payload) && isString(value.payload.reason);
    case "system.pause": return isRecord(value.payload) && (value.payload.reason === undefined || isString(value.payload.reason));
    case "system.resume": return isRecord(value.payload) && (value.payload.reason === undefined || isString(value.payload.reason));
    default: return false;
  }
}
