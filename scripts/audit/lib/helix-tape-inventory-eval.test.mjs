import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ROUTE_KEYS,
  writerGroup,
  routeKeyMatches,
  ivUnitVerdict,
  impliedContracts,
  signalEligible,
  signalEligibility,
} from "./helix-tape-inventory-eval.mjs";

const SRC = new URL("../../../src/", import.meta.url).pathname;
// The REAL production bucketing function. The harness must never reimplement it — if the panel's
// vocabulary changes, this test is where the reference list finds out.
const { executionRouteKey } = await import(`${SRC}features/helix/lib/helix-flow-format.ts`);
// Ditto for eligibility: the harness must answer with the detectors' own rule, not a copy of it.
const { signalEligible: productSignalEligible } = await import(
  `${SRC}features/helix/lib/helix-signal-detection.ts`
);

const rowA = (over = {}) => ({
  ticker: "TSLA", premium: 250_000, option_type: "CALL", fill_price: 5,
  event_at: "2026-08-21T18:00:00.000Z", alert_rule: "RepeatedHits",
  open_interest: 1200, underlying_price: 340, ...over,
});
const rowB = (over = {}) => ({
  ticker: "SPX", premium: 500_000, option_type: "PUT", fill_price: 10,
  event_at: null, alert_rule: undefined, implied_volatility: 0.17, ...over,
});

test("writerGroup names each producer by a field only that producer writes", () => {
  assert.equal(writerGroup(rowA()), "A");
  assert.equal(writerGroup(rowB()), "B");
  // Empty string is absence, not a value — the REST path serves "" rather than null for some fields.
  assert.equal(writerGroup(rowA({ alert_rule: "" })), "unknown");
  assert.equal(writerGroup(rowB({ implied_volatility: "" })), "unknown");
  assert.equal(writerGroup(null), "unknown");
});

test("writerGroup does NOT move when a timestamp appears or disappears", () => {
  // The regression this file exists to prevent. Classifying on `event_at` made #2723 — a fix that
  // gave 3500 index rows a real print time — look like Group B evaporating: "0 rows, $0, 0% of all
  // premium" about a population that had not changed at all.
  assert.equal(writerGroup(rowB({ event_at: "2026-08-21T18:00:00.000Z" })), "B");
  assert.equal(writerGroup(rowA({ event_at: null })), "A");
});

test("a row carrying BOTH producers' markers is reported as mixed, never folded into A or B", () => {
  // 0 of 5000 live. The value of the finding is that the split is exact, so the first row that
  // violates it must surface rather than be absorbed.
  assert.equal(writerGroup(rowB({ alert_rule: "SweepsFollowedByFloor" })), "mixed");
});

test("routeKeyMatches exposes the silent first-in-list precedence", () => {
  assert.deepEqual(routeKeyMatches("SweepsFollowedByFloor"), ["SWEEP", "FLOOR"]);
  // ...and the production function keeps only the first, which is the point.
  assert.equal(executionRouteKey({ alert_rule: "SweepsFollowedByFloor" }), "SWEEP");
  assert.deepEqual(routeKeyMatches("RepeatedHits"), []);
  // ...but the production function's word set also includes REPEAT (shipped in the same PR that
  // added helix-tape-inventory.mjs), so a rule the local eval helper's narrower list doesn't know
  // still buckets correctly rather than falling to OTHER.
  assert.equal(executionRouteKey({ alert_rule: "RepeatedHits" }), "REPEAT");
  assert.deepEqual(routeKeyMatches(null), []);
  // Absent alert_rule is UNREPORTED, not OTHER — OTHER means a rule WAS present and named nothing
  // we know; a print with no rule at all was never measured.
  assert.equal(executionRouteKey({ alert_rule: null }), "UNREPORTED");
});

test("ROUTE_KEYS still mirrors what the production function recognises", () => {
  for (const k of ROUTE_KEYS) {
    assert.equal(executionRouteKey({ alert_rule: k }), k, `${k} should bucket to itself`);
  }
});

test("ivUnitVerdict calls a single fractional mode fractional, and counts the misrendered tail", () => {
  // 300 rows shaped like the live sample: fractional body, small tail above the fmtIv branch.
  const values = [
    ...Array.from({ length: 288 }, (_, i) => 0.08 + (i % 20) * 0.01),
    ...Array.from({ length: 12 }, (_, i) => 3.5 + i),
  ];
  const v = ivUnitVerdict(values);
  assert.equal(v.verdict, "fractional");
  assert.ok(v.median < 1, "median should sit well under 1");
  assert.equal(v.above_branch, 12);
  assert.equal(v.misrendered, 12, "the tail above the branch is misrendered, not a second unit");
  assert.equal(v.misrendered_pct, 4);
});

test("ivUnitVerdict withholds a verdict below the sample floor rather than guessing", () => {
  const v = ivUnitVerdict([0.1, 0.2, 0.3]);
  assert.equal(v.verdict, null);
  assert.equal(v.reason, "insufficient_sample");
  assert.equal(v.sample, 3);
});

test("ivUnitVerdict ignores non-numeric and non-positive values", () => {
  const v = ivUnitVerdict([...Array.from({ length: 200 }, () => 0.2), null, "x", 0, -1, NaN]);
  assert.equal(v.sample, 200);
});

test("impliedContracts reproduces the print that looked like a units error and was not", () => {
  // SPX 7000C 2027-02-19, live 2026-08-22: $1,307,530,000 at a $933.95 fill.
  const c = impliedContracts({ premium: 1_307_530_000, fill_price: 933.95 });
  assert.equal(Math.round(c), 14_000);
});

test("impliedContracts refuses to invent a denominator", () => {
  assert.equal(impliedContracts({ premium: 1_000_000, fill_price: 0 }), null);
  assert.equal(impliedContracts({ premium: 1_000_000 }), null);
  assert.equal(impliedContracts({ fill_price: 5 }), null);
  assert.equal(impliedContracts(null), null);
});

test("signalEligible is the PRODUCT's rule — a placeable print time, not the writer group", () => {
  assert.equal(signalEligible(rowA()), true);
  assert.equal(signalEligible(rowB()), false);
  // The two are independent, and #2723 pulled them apart on the live tape: a Group B row that now
  // carries a parseable `event_at` IS eligible. Asserted against the real production function, so
  // this cannot pass by agreeing with a second copy of the rule.
  assert.equal(productSignalEligible(rowB({ event_at: "2026-08-21T18:00:00.000Z" })), true);
  assert.equal(signalEligible(rowB({ event_at: "2026-08-21T18:00:00.000Z" })), true);
  assert.equal(writerGroup(rowB({ event_at: "2026-08-21T18:00:00.000Z" })), "B");
});

test("signalEligibility names which tickers went unscanned, not just how many rows", () => {
  const e = signalEligibility([rowA(), rowB({ ticker: "SPX" }), rowB({ ticker: "SPY" })]);
  assert.equal(e.eligible, 1);
  assert.equal(e.ineligible, 2);
  assert.deepEqual(e.ineligibleTickers, ["SPX", "SPY"]);
});

test("signalEligibility reports the denominator alongside the rate", () => {
  const rows = [rowA(), rowA(), rowB(), rowB(), rowB()];
  const e = signalEligibility(rows);
  // deepEqual, not a field-by-field check: the shape is now the PRODUCT's SignalEligibility plus
  // this harness's one added percentage, and a silently dropped field would be a silent divergence.
  assert.deepEqual(e, {
    total: 5, eligible: 2, ineligible: 3, ineligibleTickers: ["SPX"], eligible_pct: 40,
  });
});

test("signalEligibility returns a null rate on an empty population, not 0%", () => {
  assert.equal(signalEligibility([]).eligible_pct, null);
});
