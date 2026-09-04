/**
 * Regression guards for RTH pin direction + quote header % checks in data-validator.mjs.
 * Run: `node --test scripts/audit/data-validator-rth-pin-quote.test.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("scripts/audit/data-validator.mjs", "utf8");

test("data-validator fetches spx pin for RTH direction checks", () => {
  assert.match(src, /spx_pin:\s*app\('\/api\/market\/spx\/pin'\)/);
});

test("data-validator: pinDriftPts tracks projectedClose − spot during RTH", () => {
  assert.match(src, /spx-pin: pinDriftPts == projectedClose − spot/);
  assert.match(src, /const derived = Number\(\(proj - pinSpot\)\.toFixed\(2\)\)/);
});

test("data-validator: quote SPY header change_pct sign + flat-0 fabrication guard", () => {
  assert.match(src, /quote SPY: change_pct sign matches Polygon/);
  assert.match(src, /quote SPY: change_pct not fabricated flat 0%/);
  assert.match(src, /quote SPY: price vs Polygon/);
});
