import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AnalyticsSnapshot, CatalogUpsert, EffectConfig, GiftEvent, OverlayConfig, PerformanceProfile, SessionSummary } from "@gta-chaos/protocol";

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return Object.keys(parsed).length ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export type SessionStats = {
  giftsReceived: number;
  effectsQueued: number;
  effectsSucceeded: number;
  effectsFailed: number;
};

export class ChaosStorage {
  private readonly db: DatabaseSync;
  constructor(path = process.env.CHAOS_DB ?? "data/chaos-live.db") {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gifts (id TEXT PRIMARY KEY, name TEXT NOT NULL, image_url TEXT, coin_cost INTEGER,
        cost_verified INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, required_quantity INTEGER NOT NULL DEFAULT 1,
        effect_ids TEXT NOT NULL, cooldown_ms INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gift_events (id TEXT PRIMARY KEY, username TEXT NOT NULL, gift_id TEXT NOT NULL,
        gift_name TEXT NOT NULL, quantity INTEGER NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS effects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
        default_duration_ms INTEGER NOT NULL, intensity REAL NOT NULL, probability REAL NOT NULL, cooldown_ms INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
        parameters TEXT NOT NULL DEFAULT '{}', conditions TEXT NOT NULL DEFAULT '{}', compatibility TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT,
        gifts_received INTEGER NOT NULL DEFAULT 0, effects_queued INTEGER NOT NULL DEFAULT 0,
        effects_succeeded INTEGER NOT NULL DEFAULT 0, effects_failed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS effect_results (command_id TEXT PRIMARY KEY, effect_id TEXT, status TEXT NOT NULL,
        error TEXT, latency_ms INTEGER, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL, event TEXT NOT NULL,
        message TEXT NOT NULL, session_id TEXT, correlation_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS overlay_config (id INTEGER PRIMARY KEY CHECK(id = 1), gameplay_share REAL NOT NULL,
        columns INTEGER NOT NULL, visible_count INTEGER NOT NULL, compact INTEGER NOT NULL DEFAULT 0, font_scale REAL NOT NULL DEFAULT 1,
        gap INTEGER NOT NULL DEFAULT 10, background_opacity REAL NOT NULL DEFAULT 0.92, alert_duration_ms INTEGER NOT NULL DEFAULT 4000, sound_enabled INTEGER NOT NULL DEFAULT 1,
        icon_scale REAL NOT NULL DEFAULT 1, card_background TEXT NOT NULL DEFAULT '#272d22', card_border TEXT NOT NULL DEFAULT '#5c694b', updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_config (id INTEGER PRIMARY KEY CHECK(id = 1), performance_profile TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    try { this.db.exec("ALTER TABLE effects ADD COLUMN priority INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing databases already have the column. */ }
    for (const column of ["parameters", "conditions"]) {
      try { this.db.exec(`ALTER TABLE effects ADD COLUMN ${column} TEXT NOT NULL DEFAULT '{}'`); } catch { /* Existing databases already have the column. */ }
    }
    for (const migration of [
      "ALTER TABLE overlay_config ADD COLUMN compact INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE overlay_config ADD COLUMN font_scale REAL NOT NULL DEFAULT 1",
      "ALTER TABLE overlay_config ADD COLUMN gap INTEGER NOT NULL DEFAULT 10",
      "ALTER TABLE overlay_config ADD COLUMN background_opacity REAL NOT NULL DEFAULT 0.92",
      "ALTER TABLE overlay_config ADD COLUMN alert_duration_ms INTEGER NOT NULL DEFAULT 4000",
      "ALTER TABLE overlay_config ADD COLUMN sound_enabled INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE overlay_config ADD COLUMN icon_scale REAL NOT NULL DEFAULT 1",
      "ALTER TABLE overlay_config ADD COLUMN card_background TEXT NOT NULL DEFAULT '#272d22'",
      "ALTER TABLE overlay_config ADD COLUMN card_border TEXT NOT NULL DEFAULT '#5c694b'",
    ]) { try { this.db.exec(migration); } catch { /* Existing databases already have the column. */ } }
    const now = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(now);
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, ?)").run(now);
  }
  upsertGift(gift: CatalogUpsert) {
    this.db.prepare(`INSERT INTO gifts(id,name,image_url,coin_cost,cost_verified,active,required_quantity,effect_ids,cooldown_ms,priority,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,image_url=excluded.image_url,coin_cost=excluded.coin_cost,
      cost_verified=excluded.cost_verified,active=excluded.active,required_quantity=excluded.required_quantity,effect_ids=excluded.effect_ids,
      cooldown_ms=excluded.cooldown_ms,priority=excluded.priority,updated_at=excluded.updated_at`).run(gift.id, gift.name, gift.imageUrl ?? null,
      gift.coinCost ?? null, gift.costVerified ? 1 : 0, gift.active ? 1 : 0, gift.requiredQuantity, JSON.stringify(gift.effectIds), gift.cooldownMs, gift.priority, new Date().toISOString());
  }
  removeGift(id: string) { this.db.prepare("DELETE FROM gifts WHERE id=?").run(id); }
  listGifts(includeInactive = false): CatalogUpsert[] {
    const rows = this.db.prepare(`SELECT * FROM gifts ${includeInactive ? "" : "WHERE active=1"} ORDER BY CASE WHEN cost_verified=1 THEN 0 ELSE 1 END, coin_cost, name`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), imageUrl: row.image_url ? String(row.image_url) : undefined,
      coinCost: typeof row.coin_cost === "number" ? row.coin_cost : undefined, costVerified: row.cost_verified === 1, active: row.active === 1,
      requiredQuantity: Number(row.required_quantity), effectIds: JSON.parse(String(row.effect_ids)), cooldownMs: Number(row.cooldown_ms), priority: Number(row.priority) }));
  }
  recordGiftEvent(event: GiftEvent) { this.db.prepare("INSERT OR IGNORE INTO gift_events(id,username,gift_id,gift_name,quantity,source,created_at,received_at) VALUES(?,?,?,?,?,?,?,?)").run(event.id, event.username, event.giftId, event.giftName, event.quantity, event.source, event.createdAt, new Date().toISOString()); }
  startSession(id: string, startedAt: string) {
    this.db.prepare("INSERT INTO sessions(id,started_at,updated_at) VALUES(?,?,?)").run(id, startedAt, new Date().toISOString());
  }
  updateSession(id: string, stats: SessionStats) {
    this.db.prepare(`UPDATE sessions SET gifts_received=?, effects_queued=?, effects_succeeded=?, effects_failed=?, updated_at=? WHERE id=?`)
      .run(stats.giftsReceived, stats.effectsQueued, stats.effectsSucceeded, stats.effectsFailed, new Date().toISOString(), id);
  }
  finishSession(id: string, stats: SessionStats, endedAt = new Date().toISOString()) {
    this.db.prepare(`UPDATE sessions SET gifts_received=?, effects_queued=?, effects_succeeded=?, effects_failed=?, ended_at=?, updated_at=? WHERE id=?`)
      .run(stats.giftsReceived, stats.effectsQueued, stats.effectsSucceeded, stats.effectsFailed, endedAt, endedAt, id);
  }
  recordEffectResult(result: { commandId: string; effectId?: string; status: string; error?: string; latencyMs?: number; createdAt: string }) {
    this.db.prepare("INSERT OR REPLACE INTO effect_results(command_id,effect_id,status,error,latency_ms,created_at) VALUES(?,?,?,?,?,?)")
      .run(result.commandId, result.effectId ?? null, result.status, result.error ?? null, result.latencyMs ?? null, result.createdAt);
  }
  recordLog(log: { level: "info" | "warn" | "error"; event: string; message: string; sessionId?: string; correlationId?: string; metadata?: Record<string, unknown>; createdAt?: string }) {
    this.db.prepare("INSERT INTO logs(level,event,message,session_id,correlation_id,metadata,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(log.level, log.event, log.message, log.sessionId ?? null, log.correlationId ?? null, JSON.stringify(log.metadata ?? {}), log.createdAt ?? new Date().toISOString());
  }
  listLogs(limit = 100) {
    const rows = this.db.prepare("SELECT id, level, event, message, session_id AS sessionId, correlation_id AS correlationId, metadata, created_at AS createdAt FROM logs ORDER BY id DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: Number(row.id), level: String(row.level), event: String(row.event), message: String(row.message), sessionId: row.sessionId ? String(row.sessionId) : undefined,
      correlationId: row.correlationId ? String(row.correlationId) : undefined, metadata: parseMetadata(row.metadata) ?? {}, createdAt: String(row.createdAt) }));
  }
  getOverlayConfig(): OverlayConfig | undefined {
    const row = this.db.prepare("SELECT gameplay_share AS gameplayShare, columns, visible_count AS visibleCount, compact, font_scale AS fontScale, gap, background_opacity AS backgroundOpacity, alert_duration_ms AS alertDurationMs, sound_enabled AS soundEnabled, icon_scale AS iconScale, card_background AS cardBackground, card_border AS cardBorder FROM overlay_config WHERE id=1").get() as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return { gameplayShare: Number(row.gameplayShare), columns: Number(row.columns) as OverlayConfig["columns"], visibleCount: Number(row.visibleCount), compact: row.compact === 1, fontScale: Number(row.fontScale ?? 1), gap: Number(row.gap ?? 10), backgroundOpacity: Number(row.backgroundOpacity ?? 0.92), alertDurationMs: Number(row.alertDurationMs ?? 4000), soundEnabled: row.soundEnabled !== 0, iconScale: Number(row.iconScale ?? 1), cardBackground: String(row.cardBackground ?? "#272d22"), cardBorder: String(row.cardBorder ?? "#5c694b") };
  }
  upsertOverlayConfig(config: OverlayConfig) {
    this.db.prepare(`INSERT INTO overlay_config(id,gameplay_share,columns,visible_count,compact,font_scale,gap,background_opacity,alert_duration_ms,sound_enabled,icon_scale,card_background,card_border,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET gameplay_share=excluded.gameplay_share, columns=excluded.columns,
      visible_count=excluded.visible_count, compact=excluded.compact, font_scale=excluded.font_scale, gap=excluded.gap,
      background_opacity=excluded.background_opacity, alert_duration_ms=excluded.alert_duration_ms, sound_enabled=excluded.sound_enabled, icon_scale=excluded.icon_scale, card_background=excluded.card_background, card_border=excluded.card_border, updated_at=excluded.updated_at`).run(config.gameplayShare, config.columns, config.visibleCount, config.compact ? 1 : 0, config.fontScale, config.gap, config.backgroundOpacity, config.alertDurationMs, config.soundEnabled ? 1 : 0, config.iconScale, config.cardBackground, config.cardBorder, new Date().toISOString());
  }
  getPerformanceProfile(): PerformanceProfile | undefined {
    const row = this.db.prepare("SELECT performance_profile AS profile FROM runtime_config WHERE id=1").get() as Record<string, unknown> | undefined;
    return row?.profile ? String(row.profile) as PerformanceProfile : undefined;
  }
  upsertPerformanceProfile(profile: PerformanceProfile) {
    this.db.prepare(`INSERT INTO runtime_config(id,performance_profile,updated_at) VALUES(1,?,?)
      ON CONFLICT(id) DO UPDATE SET performance_profile=excluded.performance_profile, updated_at=excluded.updated_at`).run(profile, new Date().toISOString());
  }
  listSessions(limit = 20): SessionSummary[] {
    const rows = this.db.prepare("SELECT id, started_at AS startedAt, ended_at AS endedAt, gifts_received AS giftsReceived, effects_queued AS effectsQueued, effects_succeeded AS effectsSucceeded, effects_failed AS effectsFailed, updated_at AS updatedAt FROM sessions ORDER BY started_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id), startedAt: String(row.startedAt), endedAt: row.endedAt ? String(row.endedAt) : undefined, giftsReceived: Number(row.giftsReceived), effectsQueued: Number(row.effectsQueued), effectsSucceeded: Number(row.effectsSucceeded), effectsFailed: Number(row.effectsFailed), updatedAt: String(row.updatedAt) }));
  }
  countSessions() { return Number((this.db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count); }
  listEffectResults() {
    const rows = this.db.prepare("SELECT command_id AS commandId, effect_id AS effectId, status, error, latency_ms AS latencyMs, created_at AS createdAt FROM effect_results ORDER BY created_at").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ commandId: String(row.commandId), effectId: row.effectId ? String(row.effectId) : null, status: String(row.status), error: row.error ? String(row.error) : null, latencyMs: row.latencyMs === null ? null : Number(row.latencyMs), createdAt: String(row.createdAt) }));
  }
  getAnalyticsSnapshot(): AnalyticsSnapshot {
    const countBy = (query: string, key: string) => {
      const rows = this.db.prepare(query).all() as Array<Record<string, unknown>>;
      return Object.fromEntries(rows.filter((row) => row[key] !== null && row[key] !== undefined).map((row) => [String(row[key]), Number(row.count)]));
    };
    const latency = this.db.prepare("SELECT AVG(latency_ms) AS averageLatencyMs FROM effect_results WHERE status='succeeded' AND latency_ms IS NOT NULL").get() as Record<string, unknown>;
    return {
      gifts: countBy("SELECT gift_name AS giftName, COUNT(*) AS count FROM gift_events GROUP BY gift_name ORDER BY count DESC", "giftName"),
      effects: countBy("SELECT effect_id AS effectId, COUNT(*) AS count FROM effect_results WHERE status='succeeded' GROUP BY effect_id ORDER BY count DESC", "effectId"),
      users: countBy("SELECT username, COUNT(*) AS count FROM gift_events GROUP BY username ORDER BY count DESC", "username"),
      averageLatencyMs: latency.averageLatencyMs === null || latency.averageLatencyMs === undefined ? 0 : Math.round(Number(latency.averageLatencyMs)),
      updatedAt: new Date().toISOString(),
    };
  }
  upsertEffect(effect: EffectConfig) {
    this.db.prepare(`INSERT INTO effects(id,name,description,category,default_duration_ms,intensity,probability,cooldown_ms,priority,parameters,conditions,compatibility,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,
      default_duration_ms=excluded.default_duration_ms,intensity=excluded.intensity,probability=excluded.probability,cooldown_ms=excluded.cooldown_ms,priority=excluded.priority,
      parameters=excluded.parameters,conditions=excluded.conditions,compatibility=excluded.compatibility,updated_at=excluded.updated_at`).run(effect.id, effect.name, effect.description, effect.category,
      effect.defaultDurationMs, effect.intensity, effect.probability, effect.cooldownMs, effect.priority ?? 0, JSON.stringify(effect.parameters ?? {}), JSON.stringify(effect.conditions ?? {}), effect.compatibility, effect.updatedAt);
  }
  listEffects(): EffectConfig[] {
    const rows = this.db.prepare("SELECT * FROM effects ORDER BY category, name").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), description: String(row.description), category: String(row.category),
      defaultDurationMs: Number(row.default_duration_ms), intensity: Number(row.intensity), probability: Number(row.probability), cooldownMs: Number(row.cooldown_ms),
      ...(Number(row.priority) > 0 ? { priority: Number(row.priority) } : {}),
      ...(parseMetadata(row.parameters) ? { parameters: parseMetadata(row.parameters) } : {}),
      ...(parseMetadata(row.conditions) ? { conditions: parseMetadata(row.conditions) } : {}),
      compatibility: String(row.compatibility) as EffectConfig["compatibility"], updatedAt: String(row.updated_at) }));
  }
  backup(destination: string) {
    if (existsSync(destination)) throw new Error(`El backup ya existe: ${destination}`);
    mkdirSync(dirname(destination), { recursive: true });
    const escaped = destination.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
  }
  close() { this.db.close(); }
}
