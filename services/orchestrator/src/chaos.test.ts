import test from "node:test";
import assert from "node:assert/strict";
import { ChaosMeter } from "./chaos.js";

test("clamps chaos points and maps to six levels", () => {
  const meter = new ChaosMeter(100, 0);
  assert.equal(meter.add(100, 1000).level, 5);
  assert.equal(meter.add(100, 1000).points, 100);
  assert.equal(meter.reset(2000).level, 0);
});

test("decays deterministically without going below zero", () => {
  const meter = new ChaosMeter(100, 10);
  meter.add(50, 1000);
  assert.equal(meter.snapshot(3000).points, 30);
  assert.equal(meter.snapshot(7000).points, 0);
});
