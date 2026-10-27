import { randomUUID } from "node:crypto";
import type { EffectCommand, GiftEvent } from "@gta-chaos/protocol";

export type GiftDefinition = {
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

export function sortGiftCatalog(gifts: readonly GiftDefinition[]): GiftDefinition[] {
  return [...gifts].sort((a, b) => {
    if (a.costVerified !== b.costVerified) return a.costVerified ? -1 : 1;
    if (a.costVerified && b.costVerified && a.coinCost !== b.coinCost) return (a.coinCost ?? Number.MAX_SAFE_INTEGER) - (b.coinCost ?? Number.MAX_SAFE_INTEGER);
    return a.name.localeCompare(b.name);
  });
}

export type RuleDecision = { status: "ignored" | "cooldown" | "queued" | "unknown_gift" | "queue_full"; commands: EffectCommand[]; reason?: string };

export class GiftRuleEngine {
  private readonly gifts = new Map<string, GiftDefinition>();
  private readonly lastTriggered = new Map<string, number>();

  upsert(definition: GiftDefinition) { this.gifts.set(definition.id, { ...definition, requiredQuantity: Math.max(1, Math.floor(definition.requiredQuantity)) }); }
  remove(id: string) { this.gifts.delete(id); }
  list() { return sortGiftCatalog([...this.gifts.values()].filter((gift) => gift.active)); }
  listAll() { return sortGiftCatalog([...this.gifts.values()]); }

  mergeGiftMetadata(id: string, name: string, imageUrl?: string, coinCost?: number, costVerified = false) {
    const existing = this.gifts.get(id);
    if (!existing) return false;
    const observedCost = costVerified && Number.isInteger(coinCost) && (coinCost as number) > 0;
    this.gifts.set(id, { ...existing, name: name || existing.name, imageUrl: imageUrl || existing.imageUrl,
      coinCost: !existing.costVerified && observedCost ? coinCost : existing.coinCost,
      costVerified: existing.costVerified || observedCost });
    return true;
  }

  evaluate(event: GiftEvent, now = Date.now()): RuleDecision {
    const gift = this.gifts.get(event.giftId);
    if (!gift) return { status: "unknown_gift", commands: [], reason: "gift_not_configured" };
    if (!gift.active || event.quantity < gift.requiredQuantity) return { status: "ignored", commands: [], reason: "inactive_or_insufficient_quantity" };
    const last = this.lastTriggered.get(gift.id) ?? 0;
    if (now - last < gift.cooldownMs) return { status: "cooldown", commands: [], reason: "gift_cooldown" };
    this.lastTriggered.set(gift.id, now);
    const commands = gift.effectIds.map((effectId, index) => ({
      id: randomUUID(), effectId, parameters: { giftId: gift.id, giftName: event.giftName, username: event.username, quantity: event.quantity },
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 15_000).toISOString(),
    }));
    return { status: "queued", commands };
  }
}
