import { test } from "node:test";
import assert from "node:assert/strict";
import { gexStaleFromAge, roundPulseNumerics } from "./spx-desk-numerics";
import type { SpxDeskPulse } from "./spx-desk";

// ── P1: the "GEX stale" pill must fire from the snapshot age on BOTH desk-GEX paths ──
test("gexStaleFromAge: within the 30s threshold → not stale", () => {
  assert.equal(gexStaleFromAge(0), false);
  assert.equal(gexStaleFromAge(10_850), false); // observed live median GEX age
  assert.equal(gexStaleFromAge(29_999), false);
});

test("gexStaleFromAge: past the 30s threshold → STALE (the 183s live regression)", () => {
  assert.equal(gexStaleFromAge(30_001), true);
  // the exact live sample (19:08:25) that the canonical path served as fresh (gex_stale:false):
  assert.equal(gexStaleFromAge(183_827), true);
});

test("gexStaleFromAge: unknown age → stale (never claim fresh on a missing age)", () => {
  assert.equal(gexStaleFromAge(null), true);
});

// ── P2: the fast pulse lane must round price-class numerics at the data layer ──
const RAW = {
  price: 7508.481234,
  spx_change_pct: 0.894321,
  vix: 17.0399,
  vix_change_pct: -8.5812,
  lod: 7467.860000000001,
  hod: 7515.31,
  vwap: 7500.4571055381375,
  pdh: 7513.2300000000005,
  pdl: 7440.53,
  prior_close: 7443.28,
  gap_pct: 0.894321,
  ema20: 7490.6383893018865,
  ema50: 7409.139833139902,
  ema200: 6997.692922110446,
  sma50: 7469.890200000002,
  sma200: 6994.995350000007,
  tick: 221,
  trin: 1.83,
  add: 1000,
  regime: "bullish",
} as unknown as SpxDeskPulse;

test("roundPulseNumerics: rounds every price-class float to 2dp (the live unrounded-leak values)", () => {
  const r = roundPulseNumerics(RAW);
  assert.equal(r.vwap, 7500.46);
  assert.equal(r.lod, 7467.86);
  assert.equal(r.ema20, 7490.64);
  assert.equal(r.ema50, 7409.14);
  assert.equal(r.pdh, 7513.23);
  assert.equal(r.sma200, 6995); // 6994.99535 → 6995.00
  assert.equal(r.price, 7508.48);
  assert.equal(r.spx_change_pct, 0.89);
  assert.equal(r.vix, 17.04);
});

test("roundPulseNumerics: no unrounded float tail survives on any field", () => {
  const r = roundPulseNumerics(RAW);
  assert.doesNotMatch(JSON.stringify(r), /\.\d{3,}/, "a field kept 3+ decimal digits");
  assert.equal(typeof r.price, "number"); // price stays non-null number
});

test("roundPulseNumerics: preserves nulls (never fabricates a 0 for a missing value)", () => {
  const withNulls = { ...RAW, vwap: null, ema200: null } as unknown as SpxDeskPulse;
  const r = roundPulseNumerics(withNulls);
  assert.equal(r.vwap, null);
  assert.equal(r.ema200, null);
});
