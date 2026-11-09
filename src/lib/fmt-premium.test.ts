import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtPremium, fmtPrice, fmtPct, pctClass } from "./api";

// fmtPremium feeds GEX Net, 0DTE Net, wall net_gex, the HELIX tape and tide
// premiums — all routinely negative — so the sign MUST sit outside the $ glyph
// and sub-$10K resolution must survive. Run: npx tsx --test src/lib/fmt-premium.test.ts

test("null renders the em-dash placeholder", () => {
  assert.equal(fmtPremium(null), "—");
});

test("negative millions sign outside the glyph (-$1.2M, not $-1.2M)", () => {
  assert.equal(fmtPremium(-1_200_000), "-$1.2M");
  assert.equal(fmtPremium(-12_400_000), "-$12.4M");
});

test("positive millions unchanged", () => {
  assert.equal(fmtPremium(1_200_000), "$1.2M");
  assert.equal(fmtPremium(2_000_000), "$2.0M");
});

test("negative thousands sign outside the glyph (-$340K, not $-340K)", () => {
  assert.equal(fmtPremium(-340_000), "-$340K");
});

test("sub-$10K keeps 1 decimal so $1.4K vs $1.5K don't collapse", () => {
  assert.equal(fmtPremium(1_400), "$1.4K");
  assert.equal(fmtPremium(1_500), "$1.5K");
  assert.equal(fmtPremium(-1_400), "-$1.4K");
  assert.equal(fmtPremium(9_900), "$9.9K");
});

test("$10K and above stays whole-K", () => {
  assert.equal(fmtPremium(10_000), "$10K");
  assert.equal(fmtPremium(340_000), "$340K");
  assert.equal(fmtPremium(-10_000), "-$10K");
});

test("sub-$1K renders whole dollars with sign outside", () => {
  assert.equal(fmtPremium(900), "$900");
  assert.equal(fmtPremium(-900), "-$900");
  assert.equal(fmtPremium(0), "$0");
});

// NaN/Infinity guard: a failed Number() upstream must render the honest em-dash,
// never a literal "$NaN" / "NaN%" on the member UI (CTO audit MEDIUM finding).
test("NaN/Infinity render the em-dash, not $NaN / NaN%", () => {
  assert.equal(fmtPremium(NaN), "—");
  assert.equal(fmtPremium(Infinity), "—");
  assert.equal(fmtPrice(NaN), "—");
  assert.equal(fmtPrice(-Infinity), "—");
  assert.equal(fmtPct(NaN), "—");
  assert.equal(fmtPct(Infinity), "—");
  assert.equal(pctClass(NaN), "num-neutral");
});

test("finite values still format normally after the guard", () => {
  assert.equal(fmtPrice(7529.65), "7,529.65");
  assert.equal(fmtPct(0.16), "+0.16%");
  assert.equal(fmtPct(-4.22), "-4.22%");
  assert.equal(pctClass(1), "num-bull");
  assert.equal(pctClass(-1), "num-bear");
});

// 6.175 is stored as a double as 6.1749999999999998..., so a bare
// n.toFixed(2) rounds the wrong way (prints "6.17"). fmtPct must round
// first, same as fmt-money.ts's own fmtPct already does. Feeds SPX desk's
// dayChange display (SpxSniperHeader/SpxLiveSpotPrice/SpxIosMarketStrip).
test("rounds the float boundary correctly instead of truncating via a raw toFixed", () => {
  assert.equal(fmtPct(6.175), "+6.18%");
});

// ---------------------------------------------------------------------------
// SIGN-BIAS ROUNDING TIE (2026-11-09) — api.ts's fmtPct rounded the raw signed
// input with a plain Math.round(n * 100) / 100 (Math.round(-0.5) === -0, not -1)
// and decided the +/- prefix with `rounded >= 0`. At the sharpest negative tie
// that flips a real negative reading to a bare "+0.00%" (`-0 >= 0` is `true` in
// JS), and at a nearby non-tie value it understates the magnitude by one cent.
// Same bug class already fixed at fmt-money.ts's fmtPct / vector-technicals.ts's
// round2 / debrief.ts / trade-explanation.ts — this was an independent,
// un-migrated duplicate feeding the SPX desk's dayChange display.
// ---------------------------------------------------------------------------
test("sign-bias rounding tie: a negative tie must not flip to a plus sign", () => {
  // Pre-fix this returned "+0.00%" — a real negative day-change reading
  // displaying with the wrong (bullish) sign.
  assert.equal(fmtPct(-0.005), "-0.01%");
  // Mirror positive tie already rounded correctly; confirm it stays byte-identical.
  assert.equal(fmtPct(0.005), "+0.01%");
});

test("sign-bias rounding tie: a nearby non-tie negative value must not understate its magnitude", () => {
  // Pre-fix this returned "-0.01%" (rounded toward zero); the mirror +0.015
  // already rounded away from zero to "+0.02%".
  assert.equal(fmtPct(-0.015), "-0.02%");
  assert.equal(fmtPct(0.015), "+0.02%");
});

test("sign-bias rounding tie: a magnitude that rounds down to exactly zero prints with no sign", () => {
  assert.equal(fmtPct(0), "0.00%");
});
