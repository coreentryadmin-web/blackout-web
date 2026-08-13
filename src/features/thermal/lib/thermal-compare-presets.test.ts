import assert from "node:assert/strict";
import test from "node:test";
import {
  THERMAL_COMPARE_PRESETS,
  orderComparePresetTickers,
  parseThermalComparePresetId,
  resolveComparePresetIdForTicker,
  thermalComparePreset,
} from "./thermal-compare-presets.ts";

test("semis preset carries the liquid chip names incl. INTC", () => {
  const semis = thermalComparePreset("semis");
  assert.equal(semis.label, "Semis");
  assert.equal(semis.tickers.length, 7);
  assert.ok(semis.tickers.includes("NVDA"));
  // INTC out-trades AVGO on day volume (626k vs 140k) and was missing from the first cut.
  assert.ok(semis.tickers.includes("INTC"));
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
  const ordered = orderComparePresetTickers(semis, "AMD");
  assert.equal(ordered[0], "AMD");
  assert.deepEqual([...ordered].sort(), [...semis.tickers].sort(), "no ticker gained or lost");
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

test("indices preset carries IWM — the third condor leg, 863k day vol", () => {
  const idx = thermalComparePreset("indices");
  assert.ok(idx.tickers.includes("SPY"));
  assert.ok(idx.tickers.includes("SPX"));
  assert.ok(idx.tickers.includes("QQQ"));
  assert.ok(idx.tickers.includes("IWM"));
});

test("macro preset covers the rates/gold/bitcoin flow no preset reached", () => {
  const macro = thermalComparePreset("macro");
  assert.equal(macro.label, "Macro");
  assert.deepEqual([...macro.tickers], ["TLT", "GLD", "IBIT"]);
});

test("healthcare replaces the mislabelled biotech preset, and old URLs still resolve", () => {
  const hc = thermalComparePreset("healthcare");
  assert.equal(hc.label, "Healthcare");
  // UNH is a health INSURER — the reason the "Biotech" label was wrong, not the names.
  assert.ok(hc.tickers.includes("UNH"));
  // compareSet lives in bookmarks and shared links, so the retired id must keep working.
  assert.equal(parseThermalComparePresetId("biotech"), "healthcare");
  assert.equal(parseThermalComparePresetId("BIOTECH"), "healthcare");
  assert.equal(resolveComparePresetIdForTicker("UNH"), "healthcare");
});

test("AI preset is disjoint from Semis — otherwise switching themes changes nothing", () => {
  const ai = new Set(thermalComparePreset("ai").tickers);
  const semis = new Set(thermalComparePreset("semis").tickers);
  const shared = [...ai].filter((t) => semis.has(t));
  assert.deepEqual(shared, [], `AI and Semis must not overlap; shared: ${shared.join(", ")}`);
});
