import assert from "node:assert/strict";
import test from "node:test";
import {
  THERMAL_COMPARE_PRESETS,
  orderComparePresetTickers,
  parseThermalComparePresetId,
  resolveComparePresetIdForTicker,
  thermalComparePreset,
} from "./thermal-compare-presets.ts";

test("semis preset includes NVDA and six names", () => {
  const semis = thermalComparePreset("semis");
  assert.equal(semis.label, "Semis");
  assert.equal(semis.tickers.length, 6);
  assert.ok(semis.tickers.includes("NVDA"));
});

test("resolveComparePresetIdForTicker maps NVDA to semis", () => {
  assert.equal(resolveComparePresetIdForTicker("NVDA"), "semis");
  assert.equal(resolveComparePresetIdForTicker("RKLB"), "space");
  assert.equal(resolveComparePresetIdForTicker("SPY"), "indices");
  assert.equal(resolveComparePresetIdForTicker("UNKNOWN"), "semis");
});

test("orderComparePresetTickers puts active ticker first", () => {
  const semis = thermalComparePreset("semis");
  assert.deepEqual(orderComparePresetTickers(semis, "AMD"), [
    "AMD",
    "NVDA",
    "AVGO",
    "MU",
    "SMCI",
    "ARM",
  ]);
});

test("parseThermalComparePresetId accepts known ids only", () => {
  assert.equal(parseThermalComparePresetId("ai"), "ai");
  assert.equal(parseThermalComparePresetId("AI"), "ai");
  assert.equal(parseThermalComparePresetId("nope"), null);
});

test("every preset has 3–6 unique tickers", () => {
  for (const preset of THERMAL_COMPARE_PRESETS) {
    assert.ok(preset.tickers.length >= 3 && preset.tickers.length <= 6, preset.id);
    assert.equal(new Set(preset.tickers).size, preset.tickers.length, preset.id);
  }
});
