export type PerformanceProfile = "low" | "balanced" | "high";
export type PerformanceConfig = { profile: PerformanceProfile; queueLimit: number; maxActiveEffects: number };

const presets: Record<PerformanceProfile, PerformanceConfig> = {
  low: { profile: "low", queueLimit: 25, maxActiveEffects: 8 },
  balanced: { profile: "balanced", queueLimit: 100, maxActiveEffects: 24 },
  high: { profile: "high", queueLimit: 120, maxActiveEffects: 48 },
};

export function performanceConfig(profile: PerformanceProfile): PerformanceConfig { return { ...presets[profile] }; }
export function isPerformanceProfile(value: unknown): value is PerformanceProfile { return value === "low" || value === "balanced" || value === "high"; }
