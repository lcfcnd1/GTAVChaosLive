import test from "node:test";
import assert from "node:assert/strict";
import { isPerformanceProfile, performanceConfig } from "./performance.js";

test("provides bounded low, balanced and high resource presets", () => {
  assert.deepEqual(performanceConfig("low"), { profile: "low", queueLimit: 25, maxActiveEffects: 8 });
  assert.deepEqual(performanceConfig("balanced"), { profile: "balanced", queueLimit: 100, maxActiveEffects: 24 });
  assert.deepEqual(performanceConfig("high"), { profile: "high", queueLimit: 120, maxActiveEffects: 48 });
  assert.equal(isPerformanceProfile("invalid"), false);
});
