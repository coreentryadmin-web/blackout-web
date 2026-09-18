import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCandidateRMultiples } from "./candidate-r-multiple";
import type { CandidateForwardReturns } from "./candidate-forward-grade";
import type { ParsedPlayLevels } from "./play-levels";

function levels(overrides: Partial<ParsedPlayLevels>): ParsedPlayLevels {
  return { entry_range_low: 98, entry_range_high: 100, target: 112, stop: 94, ...overrides };
}

function forwardReturns(overrides: Partial<CandidateForwardReturns>): CandidateForwardReturns {
  return {
    schema_version: 2,
    entry_price: 100,
    entry_at: "2026-09-18T13:30:00.000Z",
    horizons: { m5: null, m15: null, m30: null, h1: null, eod: null },
    session_high_pct: null,
    session_high_at: null,
    session_low_pct: null,
    session_low_at: null,
    graded_at: "2026-09-18T20:00:00.000Z",
    ...overrides,
  };
}

test("computeCandidateRMultiples: no direction -> null outright, never a partial result", () => {
  assert.equal(computeCandidateRMultiples(null, levels({}), forwardReturns({})), null);
  assert.equal(computeCandidateRMultiples(undefined, levels({}), forwardReturns({})), null);
});

test("computeCandidateRMultiples: no levels -> null outright", () => {
  assert.equal(computeCandidateRMultiples("LONG", null, forwardReturns({})), null);
});

test("computeCandidateRMultiples: LONG fills at entry_range_high, risk is entry-stop", () => {
  const r = computeCandidateRMultiples("LONG", levels({ entry_range_high: 100, stop: 94 }), forwardReturns({}));
  assert.equal(r?.entry_price, 100);
  assert.equal(r?.stop_price, 94);
  assert.equal(r?.risk_per_share, 6);
});

test("computeCandidateRMultiples: SHORT fills at entry_range_low, risk is stop-entry", () => {
  const r = computeCandidateRMultiples("SHORT", levels({ entry_range_low: 98, stop: 104 }), forwardReturns({}));
  assert.equal(r?.entry_price, 98);
  assert.equal(r?.stop_price, 104);
  assert.equal(r?.risk_per_share, 6);
});

test("computeCandidateRMultiples: inverted risk (stop on the wrong side of entry) -> risk null, no R fabricated", () => {
  // LONG with stop ABOVE the fill edge -- an invalid geometry the caller should have gated
  // elsewhere; this module just refuses to divide by a negative/zero distance.
  const r = computeCandidateRMultiples("LONG", levels({ entry_range_high: 100, stop: 105 }), forwardReturns({}));
  assert.equal(r?.risk_per_share, null);
  assert.deepEqual(r?.horizons_r, { m5: null, m15: null, m30: null, h1: null, eod: null });
  assert.equal(r?.mfe_r, null);
  assert.equal(r?.mae_r, null);
});

test("computeCandidateRMultiples: zero risk (entry == stop) -> null risk, not Infinity/NaN", () => {
  const r = computeCandidateRMultiples("LONG", levels({ entry_range_high: 100, stop: 100 }), forwardReturns({}));
  assert.equal(r?.risk_per_share, null);
});

test("computeCandidateRMultiples: missing forward_returns entry_price -> geometry fields set, R fields null", () => {
  const r = computeCandidateRMultiples(
    "LONG",
    levels({ entry_range_high: 100, stop: 94 }),
    forwardReturns({ entry_price: null })
  );
  assert.equal(r?.risk_per_share, 6);
  assert.deepEqual(r?.horizons_r, { m5: null, m15: null, m30: null, h1: null, eod: null });
});

test("computeCandidateRMultiples: null forward_returns entirely -> geometry fields set, R fields null", () => {
  const r = computeCandidateRMultiples("LONG", levels({ entry_range_high: 100, stop: 94 }), null);
  assert.equal(r?.risk_per_share, 6);
  assert.equal(r?.mfe_r, null);
});

test("computeCandidateRMultiples: LONG horizon R -- a +3% session move on a 6% risk play is +0.5R", () => {
  // sessionEntry=100 (forward_returns' own open anchor), play fill edge also 100 here for a
  // clean check; +3% move -> price 103 -> favorable = 103-100=3 -> R = 3/6 = 0.5
  const r = computeCandidateRMultiples(
    "LONG",
    levels({ entry_range_high: 100, stop: 94 }),
    forwardReturns({ entry_price: 100, horizons: { m5: 3, m15: null, m30: null, h1: null, eod: null } })
  );
  assert.equal(r?.horizons_r.m5, 0.5);
});

test("computeCandidateRMultiples: SHORT horizon R sign-flips correctly -- a -3% move favors a SHORT", () => {
  const r = computeCandidateRMultiples(
    "SHORT",
    levels({ entry_range_low: 100, stop: 106 }),
    forwardReturns({ entry_price: 100, horizons: { m5: -3, m15: null, m30: null, h1: null, eod: null } })
  );
  // risk = 106-100 = 6; price = 100*(1-0.03) = 97; favorable = entry-price = 100-97=3; R=3/6=0.5
  assert.equal(r?.horizons_r.m5, 0.5);
});

test("computeCandidateRMultiples: LONG mfe_r uses session_high_pct, mae_r uses session_low_pct", () => {
  const r = computeCandidateRMultiples(
    "LONG",
    levels({ entry_range_high: 100, stop: 94 }),
    forwardReturns({ entry_price: 100, session_high_pct: 6, session_low_pct: -3 })
  );
  // mfe: price=106, favorable=6, R=6/6=1.0
  assert.equal(r?.mfe_r, 1);
  // mae: price=97, favorable=97-100=-3, R=-3/6=-0.5
  assert.equal(r?.mae_r, -0.5);
});

test("computeCandidateRMultiples: SHORT mfe_r/mae_r swap sides vs LONG (session_low is SHORT-favorable)", () => {
  const r = computeCandidateRMultiples(
    "SHORT",
    levels({ entry_range_low: 100, stop: 106 }),
    forwardReturns({ entry_price: 100, session_high_pct: 3, session_low_pct: -6 })
  );
  // SHORT favorable = session_low_pct = -6 -> price=94 -> favorable=100-94=6 -> R=6/6=1.0
  assert.equal(r?.mfe_r, 1);
  // SHORT adverse = session_high_pct = 3 -> price=103 -> favorable=100-103=-3 -> R=-3/6=-0.5
  assert.equal(r?.mae_r, -0.5);
});

test("computeCandidateRMultiples: a horizon that's individually null (bar not yet available) stays null, doesn't zero out the whole result", () => {
  const r = computeCandidateRMultiples(
    "LONG",
    levels({ entry_range_high: 100, stop: 94 }),
    forwardReturns({ entry_price: 100, horizons: { m5: 3, m15: null, m30: 5, h1: null, eod: 8 } })
  );
  assert.equal(r?.horizons_r.m5, 0.5);
  assert.equal(r?.horizons_r.m15, null);
  assert.notEqual(r?.horizons_r.m30, null);
  assert.equal(r?.horizons_r.h1, null);
  assert.notEqual(r?.horizons_r.eod, null);
});
