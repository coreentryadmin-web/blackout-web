import assert from "node:assert/strict";
import test from "node:test";
import {
  THERMAL_COMPARE_PRESETS,
  orderComparePresetTickers,
  parseThermalComparePresetId,
  resolveComparePresetIdForTicker,
  thermalComparePreset,
} from "./thermal-compare-presets.ts";

test("semis preset includes NVDA and five names", () => {
  const semis = thermalComparePreset("semis");
  assert.equal(semis.label, "Semis");
  assert.equal(semis.tickers.length, 5);
  assert.ok(semis.tickers.includes("NVDA"));
});

test("resolveComparePresetIdForTicker maps NVDA to semis and SPY to indices", () => {
  assert.equal(resolveComparePresetIdForTicker("NVDA"), "semis");
  assert.equal(resolveComparePresetIdForTicker("RKLB"), "space");
  assert.equal(resolveComparePresetIdForTicker("SPY"), "indices");
  assert.equal(resolveComparePresetIdForTicker("SPX"), "indices");
  assert.equal(resolveComparePresetIdForTicker("QQQ"), "indices");
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
  ]);
});

test("parseThermalComparePresetId accepts known ids only", () => {
  assert.equal(parseThermalComparePresetId("ai"), "ai");
  assert.equal(parseThermalComparePresetId("AI"), "ai");
  assert.equal(parseThermalComparePresetId("nope"), null);
});

test("every preset has 3–7 unique tickers", () => {
  for (const preset of THERMAL_COMPARE_PRESETS) {
    assert.ok(preset.tickers.length >= 3 && preset.tickers.length <= 7, preset.id);
    assert.equal(new Set(preset.tickers).size, preset.tickers.length, preset.id);
  }
});

test("mag 7 preset includes GOOG and TSLA", () => {
  const mag7 = thermalComparePreset("mega");
  assert.equal(mag7.label, "Mag 7");
  assert.equal(mag7.tickers.length, 7);
  assert.ok(mag7.tickers.includes("GOOG"));
  assert.ok(mag7.tickers.includes("TSLA"));
  assert.equal(resolveComparePresetIdForTicker("GOOGL"), "mega");
  assert.equal(resolveComparePresetIdForTicker("TSLA"), "mega");
});

test("indices preset is the classic SPY SPX QQQ triple", () => {
  const idx = thermalComparePreset("indices");
  assert.deepEqual([...idx.tickers], ["SPY", "SPX", "QQQ"]);
});
