import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateStopPlausibility } from "./stop-plausibility-eval.mjs";

function row(overrides) {
  return {
    exit_reason: "stop",
    exit_pnl_pct: -50,
    first_flagged_at: "2026-08-27T14:00:00.000Z",
    exit_at: "2026-08-27T14:00:03.000Z",
    ...overrides,
  };
}

test("live QQQ case: large overshoot + sub-second latency + flat underlying → SUSPECT", () => {
  // Reproduces the exact live measurement: -50 plan stop, -77.06 realized, 0.357s, 0.15% underlying move.
  const r = row({
    exit_pnl_pct: -77.06,
    first_flagged_at: "2026-08-27T14:12:30.000Z",
    exit_at: "2026-08-27T14:12:30.357Z",
  });
  const verdict = evaluateStopPlausibility(r, 0.15);
  assert.equal(verdict.suspect, true);
  assert.match(verdict.reason, /implausible without a bad\/erroneous quote tick/);
  assert.ok(verdict.overshootPts > 15);
  assert.ok(verdict.latencySec < 1);
});

test("live NVDA case: small overshoot never even reaches the check → not suspect", () => {
  // -50 plan stop, -52.9 realized: only 2.9pts, well under normal-slippage territory.
  const r = row({ exit_pnl_pct: -52.9, exit_at: "2026-08-27T14:00:01.248Z" });
  const verdict = evaluateStopPlausibility(r, 0.05);
  assert.equal(verdict.suspect, false);
  assert.match(verdict.reason, /within normal slippage/);
});

test("a real, fast, violent underlying move is NOT suspect — the move explains the overshoot", () => {
  const r = row({ exit_pnl_pct: -80 });
  const verdict = evaluateStopPlausibility(r, 5.0); // a genuine 5% underlying gap
  assert.equal(verdict.suspect, false);
  assert.match(verdict.reason, /large enough to plausibly explain/);
});

test("a large overshoot that took minutes to develop is NOT suspect — real drift, not an instant glitch", () => {
  const r = row({
    exit_pnl_pct: -80,
    first_flagged_at: "2026-08-27T14:00:00.000Z",
    exit_at: "2026-08-27T14:05:00.000Z", // 5 minutes
  });
  const verdict = evaluateStopPlausibility(r, 0.1);
  assert.equal(verdict.suspect, false);
  assert.match(verdict.reason, /long enough for a real drift-into-stop/);
});

test("non-stop exit reasons are never evaluated", () => {
  const verdict = evaluateStopPlausibility(row({ exit_reason: "thesis" }), 0.1);
  assert.equal(verdict.suspect, false);
  assert.equal(verdict.reason, "not a stop exit");
});

test("missing exit_pnl_pct never fabricates a verdict", () => {
  const verdict = evaluateStopPlausibility(row({ exit_pnl_pct: null }), 0.1);
  assert.equal(verdict.suspect, false);
  assert.equal(verdict.reason, "no exit_pnl_pct on the row");
});

test("missing underlying bars reports unable-to-corroborate, never guesses suspect or clean", () => {
  const r = row({ exit_pnl_pct: -80 });
  const verdict = evaluateStopPlausibility(r, null);
  assert.equal(verdict.suspect, false);
  assert.equal(verdict.reason, "underlying bars unavailable — cannot corroborate");
});

test("a custom stop_pct on the row is honored instead of the -50 default", () => {
  // A -30 plan stop realized at -50 is a 20pt overshoot even though -50 alone looks "normal" by
  // the -50-default reading.
  const r = row({ stop_pct: -30, exit_pnl_pct: -50 });
  const verdict = evaluateStopPlausibility(r, 0.1);
  assert.equal(verdict.suspect, true);
  assert.equal(verdict.overshootPts, 20);
});
