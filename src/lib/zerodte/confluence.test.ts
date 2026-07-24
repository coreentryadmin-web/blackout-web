import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeConfluence,
  attachConfluence,
  POST_OPEN_ET_MINUTES,
  EARLY_ENTRY_WINDOW_END_ET_MINUTES,
} from "./confluence";
import type { EnrichedZeroDteSetup } from "./board";

const POST_OPEN = POST_OPEN_ET_MINUTES + 30; // 10:30 ET — favorable window
const OPEN_CHOP = 9 * 60 + 40; // 9:40 ET — still in opening chop
const EARLY = POST_OPEN_ET_MINUTES + 15; // 10:15 ET — inside the measured-negative early window
const LATE = 11 * 60; // 11:00 ET — past the early window (first positive EV cell)

// Minimal setup stub with only the fields computeConfluence reads.
function setup(over: Partial<EnrichedZeroDteSetup> = {}): EnrichedZeroDteSetup {
  return {
    ticker: "SPY",
    direction: "long",
    intraday: { vwap: 500, last: 502 } as EnrichedZeroDteSetup["intraday"],
    market_aligned: true,
    ...over,
  } as EnrichedZeroDteSetup;
}

test("triple-confirmed: post-open timing + price above VWAP (long) + market aligned", () => {
  const c = computeConfluence(setup(), POST_OPEN);
  assert.equal(c.timing_ok, true);
  assert.equal(c.vwap_ok, true);
  assert.equal(c.market_ok, true);
  assert.equal(c.score, 3);
  assert.equal(c.tier, "triple");
});

test("double bucket (the measured +15.9% EV edge) = VWAP + market, but off-timing", () => {
  const c = computeConfluence(setup(), OPEN_CHOP); // timing fails
  assert.equal(c.timing_ok, false);
  assert.equal(c.vwap_ok, true);
  assert.equal(c.market_ok, true);
  assert.equal(c.score, 2);
  assert.equal(c.tier, "double");
});

test("VWAP side is direction-aware: a short below VWAP confirms; above VWAP does not", () => {
  const shortConfirmed = computeConfluence(setup({ direction: "short", intraday: { vwap: 500, last: 497 } as EnrichedZeroDteSetup["intraday"] }), POST_OPEN);
  assert.equal(shortConfirmed.vwap_ok, true);
  const shortWrongSide = computeConfluence(setup({ direction: "short", intraday: { vwap: 500, last: 503 } as EnrichedZeroDteSetup["intraday"] }), POST_OPEN);
  assert.equal(shortWrongSide.vwap_ok, false);
});

test("market_aligned null/false is NOT a confirmation (never fabricated)", () => {
  assert.equal(computeConfluence(setup({ market_aligned: null }), POST_OPEN).market_ok, false);
  assert.equal(computeConfluence(setup({ market_aligned: false }), POST_OPEN).market_ok, false);
});

test("missing intraday read → vwap_ok false, no crash", () => {
  const c = computeConfluence(setup({ intraday: null }), POST_OPEN);
  assert.equal(c.vwap_ok, false);
  assert.equal(c.tier, "weak"); // only timing+market can't reach double (needs vwap+market)
});

test("weak when only one leg agrees", () => {
  const c = computeConfluence(setup({ market_aligned: null, intraday: { vwap: 500, last: 498 } as EnrichedZeroDteSetup["intraday"] }), POST_OPEN);
  assert.equal(c.score, 1); // timing only
  assert.equal(c.tier, "weak");
  assert.match(c.label, /weak|unconfirmed/);
});

test("attachConfluence mutates every setup in place", () => {
  const s = [setup(), setup({ ticker: "QQQ", market_aligned: false })];
  attachConfluence(s, POST_OPEN);
  assert.equal(s[0].confluence?.tier, "triple");
  assert.equal(s[1].confluence?.tier, "weak"); // timing+VWAP but market false → not a double
});

// ── confirmations count (the E3 axis G-12 gates on) ─────────────────────────────────

test("confirmations = VWAP-side + market-aligned only (NOT timing) — maps to the E3 buckets", () => {
  // Both legs agree → 2 confirmations (the +15.9% EV bucket), regardless of timing.
  assert.equal(computeConfluence(setup(), POST_OPEN).confirmations, 2);
  assert.equal(computeConfluence(setup(), OPEN_CHOP).confirmations, 2); // timing off, still 2 confs
  // One leg (VWAP only, market null) → 1 confirmation (the ~0% EV bucket).
  assert.equal(
    computeConfluence(setup({ market_aligned: null }), POST_OPEN).confirmations,
    1
  );
  // Neither leg → 0 confirmations (the −12.5% EV loser) even though `score` still counts timing.
  const zero = computeConfluence(
    setup({ market_aligned: null, intraday: { vwap: 500, last: 498 } as EnrichedZeroDteSetup["intraday"] }),
    POST_OPEN
  );
  assert.equal(zero.confirmations, 0);
  assert.equal(zero.score, 1); // timing leg alone — proving score can't distinguish 0-conf, confirmations can
});

// ── early_window flag (Change 2 — higher floor + half size 10:00–10:45) ──────────────

test("early_window is true only inside [10:00, 10:45) ET", () => {
  assert.equal(computeConfluence(setup(), EARLY).early_window, true); // 10:15 — inside
  assert.equal(computeConfluence(setup(), POST_OPEN_ET_MINUTES).early_window, true); // 10:00 — inclusive start
  assert.equal(computeConfluence(setup(), EARLY_ENTRY_WINDOW_END_ET_MINUTES).early_window, false); // 10:45 — exclusive end
  assert.equal(computeConfluence(setup(), LATE).early_window, false); // 11:00 — past it
  assert.equal(computeConfluence(setup(), OPEN_CHOP).early_window, false); // 9:40 — before the unlock
});
