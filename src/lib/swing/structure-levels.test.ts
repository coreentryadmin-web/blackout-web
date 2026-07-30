import { test } from "node:test";
import assert from "node:assert/strict";
import { atrProxyFromCloses, deriveSwingPlanLevels } from "./structure-levels";

test("atrProxyFromCloses: averages absolute close-to-close moves", () => {
  const closes = [100, 101, 102, 101, 103, 104, 103, 105, 106, 105, 107, 108, 107, 109, 110];
  const atr = atrProxyFromCloses(closes, 14);
  assert.ok(atr != null && atr > 0);
  assert.equal(atrProxyFromCloses([100, 101], 14), null);
});

test("deriveSwingPlanLevels: LONG stop below / target above at ~1.8R", () => {
  const p = deriveSwingPlanLevels("LONG", 100, 2);
  assert.ok(p);
  assert.equal(p.entryUnderlyingPx, 100);
  assert.equal(p.thesisInvalidationPx, 97); // 100 - 1.5*2
  assert.equal(p.targetUnderlyingPx, 105.4); // 100 + 2.7*2
  const rr = (p.targetUnderlyingPx - p.entryUnderlyingPx) / (p.entryUnderlyingPx - p.thesisInvalidationPx);
  assert.ok(Math.abs(rr - 1.8) < 1e-9);
});

test("deriveSwingPlanLevels: SHORT mirrors; null price → null plan", () => {
  const p = deriveSwingPlanLevels("SHORT", 100, 2);
  assert.ok(p);
  assert.equal(p.thesisInvalidationPx, 103);
  assert.equal(p.targetUnderlyingPx, 94.6);
  assert.equal(deriveSwingPlanLevels("LONG", 0, 2), null);
});

test("deriveSwingPlanLevels: thin ATR falls back to 1.5% of price", () => {
  const p = deriveSwingPlanLevels("LONG", 200, null);
  assert.ok(p);
  assert.equal(p.atr, 3); // 200 * 0.015
  assert.equal(p.thesisInvalidationPx, 200 - 1.5 * 3);
});
