import type { EffectCommand, EffectConfig, GiftEvent } from "@gta-chaos/protocol";

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

export function effectConditionMatches(config: EffectConfig | undefined, event: GiftEvent, chaosLevel: number): boolean {
  const conditions = config?.conditions;
  if (!conditions) return true;
  const minQuantity = integer(conditions.minQuantity);
  const maxQuantity = integer(conditions.maxQuantity);
  const minChaosLevel = integer(conditions.minChaosLevel);
  const maxChaosLevel = integer(conditions.maxChaosLevel);
  if (minQuantity !== undefined && event.quantity < minQuantity) return false;
  if (maxQuantity !== undefined && event.quantity > maxQuantity) return false;
  if (minChaosLevel !== undefined && chaosLevel < minChaosLevel) return false;
  if (maxChaosLevel !== undefined && chaosLevel > maxChaosLevel) return false;
  if (conditions.requireCostVerified === true && event.costVerified !== true) return false;
  const allowedGiftIds = stringArray(conditions.allowedGiftIds);
  const allowedSources = stringArray(conditions.allowedSources);
  if (allowedGiftIds && !allowedGiftIds.includes(event.giftId)) return false;
  if (allowedSources && !allowedSources.includes(event.source)) return false;
  return true;
}

export function applyEffectPolicies(commands: EffectCommand[], configs: Map<string, EffectConfig>, event: GiftEvent, chaosLevel: number, random: () => number = Math.random) {
  const rejectedEffectIds: string[] = [];
  const allowed = commands.filter((command) => {
    const config = configs.get(command.effectId);
    if (!effectConditionMatches(config, event, chaosLevel)) {
      rejectedEffectIds.push(command.effectId);
      return false;
    }
    if (config && config.probability < 1 && random() >= config.probability) {
      rejectedEffectIds.push(command.effectId);
      return false;
    }
    // Runtime gift context remains available while configured values are merged
    // as declarative defaults. No metadata is evaluated as code.
    const defaultDuration = config && config.defaultDurationMs > 0 && command.parameters.durationMs === undefined
      ? { durationMs: config.defaultDurationMs }
      : {};
    command.parameters = { ...command.parameters, ...defaultDuration, ...(config?.parameters ?? {}) };
    return true;
  });
  return { commands: allowed, rejectedEffectIds };
}

export function sortEffectCommands(commands: EffectCommand[], configs: ReadonlyMap<string, Pick<EffectConfig, "priority">>): EffectCommand[] {
  return [...commands].sort((a, b) => (configs.get(b.effectId)?.priority ?? 0) - (configs.get(a.effectId)?.priority ?? 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
