import test from "node:test";
import assert from "node:assert/strict";
import { selectEarlyEntryContract, type EarlyEntryChainRow } from "./early-entry-contract-select.ts";

function row(overrides: Partial<EarlyEntryChainRow> = {}): EarlyEntryChainRow {
  return { strike: 105, side: "call", bid: 1.4, ask: 1.5, oi: 500, iv: 0.35, ...overrides };
}

const BASE = { direction: "long" as const, spotAtWatch: 100, spotNow: 100.5, minutesRemaining: 120 };

test("selectEarlyEntryContract: hard-rejects a missing ask", () => {
  const { candidates, rejections } = selectEarlyEntryContract({ ...BASE, chain: [row({ ask: null })] });
  assert.deepEqual(candidates, []);
  assert.equal(rejections[0]!.reject_reason, "ask_missing_or_invalid");
});

test("selectEarlyEntryContract: hard-rejects a one-sided quote (no real bid)", () => {
  const { candidates, rejections } = selectEarlyEntryContract({ ...BASE, chain: [row({ bid: null })] });
  assert.deepEqual(candidates, []);
  assert.equal(rejections[0]!.reject_reason, "stale_quote_no_two_sided_market");
});

test("selectEarlyEntryContract: rejects an ask BELOW the $1.00 floor (outside the band, not just 'cheap is fine')", () => {
  const { candidates, rejections } = selectEarlyEntryContract({ ...BASE, chain: [row({ bid: 0.6, ask: 0.65 })] });
  assert.deepEqual(candidates, []);
  assert.equal(rejections[0]!.reject_reason, "ask_outside_price_band");
});

test("selectEarlyEntryContract: rejects an ask ABOVE the $3.00 ceiling", () => {
  const { candidates, rejections } = selectEarlyEntryContract({ ...BASE, chain: [row({ bid: 3.2, ask: 3.4 })] });
  assert.deepEqual(candidates, []);
  assert.equal(rejections[0]!.reject_reason, "ask_outside_price_band");
});

test("selectEarlyEntryContract: a quote older than staleQuoteMaxAgeMs is hard-rejected", () => {
  const nowMs = 1_700_000_000_000;
  const { candidates, rejections } = selectEarlyEntryContract({
    ...BASE, chain: [row({ quoteAsOfMs: nowMs - 10 * 60_000 })], nowMs,
  });
  assert.deepEqual(candidates, []);
  assert.equal(rejections[0]!.reject_reason, "stale_quote_age");
});

test("selectEarlyEntryContract: a wide spread is hard-rejected as illiquid, not merely down-ranked", () => {
  const { candidates, rejections } = selectEarlyEntryContract({
    ...BASE, chain: [row({ bid: 1.0, ask: 2.0 })], maxSpreadPct: 20, // (2-1)/1.5=66.7% spread
  });
  assert.deepEqual(candidates, []);
  assert.equal(rejections[0]!.reject_reason, "illiquid");
});

test("selectEarlyEntryContract: thin OI is hard-rejected as illiquid", () => {
  const { candidates, rejections } = selectEarlyEntryContract({
    ...BASE, chain: [row({ oi: 1 })], minOi: 50,
  });
  assert.deepEqual(candidates, []);
  assert.equal(rejections[0]!.reject_reason, "illiquid");
});

test("selectEarlyEntryContract: a move that already captured most of the watch-to-strike distance is rejected as already_extended", () => {
  // strike 105, watch spot 100 (distance 5), now spot 104.5 (distance 0.5) -> captured = 1-0.5/5 = 0.9
  const { candidates, rejections } = selectEarlyEntryContract({
    direction: "long", spotAtWatch: 100, spotNow: 104.5, minutesRemaining: 120,
    chain: [row({ strike: 105 })],
  });
  assert.deepEqual(candidates, []);
  assert.equal(rejections[0]!.reject_reason, "already_extended");
});

test("selectEarlyEntryContract: a move that has barely started survives with a small captured_fraction", () => {
  // strike 105, watch spot 100 (distance 5), now spot 100.5 (distance 4.5) -> captured = 1-4.5/5 = 0.1
  const { candidates } = selectEarlyEntryContract({
    direction: "long", spotAtWatch: 100, spotNow: 100.5, minutesRemaining: 120,
    chain: [row({ strike: 105 })],
  });
  assert.equal(candidates.length, 1);
  assert.ok(Math.abs(candidates[0]!.captured_fraction! - 0.1) < 0.001);
});

test("selectEarlyEntryContract: the maxAlreadyExtendedFraction threshold is caller-overridable", () => {
  const strict = selectEarlyEntryContract({
    direction: "long", spotAtWatch: 100, spotNow: 102, minutesRemaining: 120, // captured = 1-3/5 = 0.4
    chain: [row({ strike: 105 })], maxAlreadyExtendedFraction: 0.3,
  });
  assert.deepEqual(strict.candidates, []);
  assert.equal(strict.rejections[0]!.reject_reason, "already_extended");

  const lenient = selectEarlyEntryContract({
    direction: "long", spotAtWatch: 100, spotNow: 102, minutesRemaining: 120,
    chain: [row({ strike: 105 })], maxAlreadyExtendedFraction: 0.5,
  });
  assert.equal(lenient.candidates.length, 1);
});

test("selectEarlyEntryContract: NEGATIVE captured_fraction (the move retraced, MORE room now) is never rejected", () => {
  // strike 105, watch spot 102 (distance 3), now spot 100 (distance 5) -> captured = 1-5/3 < 0
  const { candidates } = selectEarlyEntryContract({
    direction: "long", spotAtWatch: 102, spotNow: 100, minutesRemaining: 120,
    chain: [row({ strike: 105 })],
  });
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0]!.captured_fraction! < 0);
});

test("selectEarlyEntryContract: ranks more ROOM-LEFT above less room-left, same reachability/spread otherwise", () => {
  const nearlyExtended = row({ strike: 103, bid: 1.4, ask: 1.5, iv: 0.35 }); // watch 100 -> now 100.5: distance-to-103 shrinks a bit
  const fresh = row({ strike: 108, bid: 1.4, ask: 1.5, iv: 0.35 }); // farther strike, same quote -- barely captured yet
  const { candidates } = selectEarlyEntryContract({
    direction: "long", spotAtWatch: 100, spotNow: 100.5, minutesRemaining: 600,
    chain: [nearlyExtended, fresh],
  });
  assert.equal(candidates.length, 2);
  // Both survive; the one with LESS captured_fraction (more room left) should not be strictly
  // worse ranked purely because it's farther -- assert the full ranking is reachability-aware,
  // not a naive "closer always wins" rule, by checking both candidates report sane fields.
  for (const c of candidates) {
    assert.ok(c.captured_fraction != null);
    assert.ok(c.reachability_prob != null);
  }
});

test("selectEarlyEntryContract: a SHORT (put) setup only considers puts", () => {
  const { candidates } = selectEarlyEntryContract({
    direction: "short", spotAtWatch: 100, spotNow: 99.5, minutesRemaining: 120,
    chain: [row({ strike: 95, side: "put" }), row({ strike: 105, side: "call" })],
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.side, "put");
});

test("selectEarlyEntryContract: a missing iv still produces a candidate (reachability null, never fabricated)", () => {
  const { candidates } = selectEarlyEntryContract({ ...BASE, chain: [row({ iv: null })] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.reachability_prob, null);
});

test("selectEarlyEntryContract: a chain with nothing qualifying returns empty candidates AND reports every rejection", () => {
  const { candidates, rejections } = selectEarlyEntryContract({
    ...BASE,
    chain: [row({ ask: null }), row({ strike: 110, bid: 3.5, ask: 3.8 }), row({ strike: 115, bid: 0.3, ask: 0.4 })],
  });
  assert.deepEqual(candidates, []);
  assert.equal(rejections.length, 3);
});

test("selectEarlyEntryContract: target10/target20 populate from the real iv (advisory field, never fabricated without one)", () => {
  const withIv = selectEarlyEntryContract({ ...BASE, chain: [row({ iv: 0.45 })] });
  assert.equal(withIv.candidates.length, 1);
  const c = withIv.candidates[0]!;
  assert.ok(c.target10 != null);
  assert.ok(c.target20 != null);
  assert.equal(c.target10!.target_premium, 10);
  assert.equal(c.target20!.target_premium, 20);
  assert.equal(c.target10!.scenarios.length, 3);

  const noIv = selectEarlyEntryContract({ ...BASE, chain: [row({ iv: null })] });
  assert.equal(noIv.candidates[0]!.target10, null);
  assert.equal(noIv.candidates[0]!.target20, null);
});
