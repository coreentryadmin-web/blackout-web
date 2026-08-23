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

const rowA = (over = {}) => ({
  ticker: "TSLA", premium: 250_000, option_type: "CALL", fill_price: 5,
  event_at: "2026-08-21T18:00:00.000Z", alert_rule: "RepeatedHits",
  open_interest: 1200, underlying_price: 340, ...over,
});
const rowB = (over = {}) => ({
  ticker: "SPX", premium: 500_000, option_type: "PUT", fill_price: 10,
  event_at: null, alert_rule: undefined, implied_volatility: 0.17, ...over,
});

test("writerGroup separates the two producers on the fields that actually co-vary", () => {
  assert.equal(writerGroup(rowA()), "A");
  assert.equal(writerGroup(rowB()), "B");
  // Empty string is absence, not a value — the REST path serves "" for a timestampless print.
  assert.equal(writerGroup(rowB({ event_at: "" })), "B");
  assert.equal(writerGroup(rowA({ alert_rule: "" })), "mixed");
  assert.equal(writerGroup(null), "unknown");
});

test("a row that breaks the clean split is reported as mixed, never folded into A or B", () => {
  // 0 of 5000 live today. The whole value of the finding is that the split is exact, so the first
  // row that violates it must surface rather than be absorbed.
  assert.equal(writerGroup(rowA({ event_at: null })), "mixed");
  assert.equal(writerGroup(rowB({ alert_rule: "SweepsFollowedByFloor" })), "mixed");
});

test("routeKeyMatches exposes the silent first-in-list precedence", () => {
  assert.deepEqual(routeKeyMatches("SweepsFollowedByFloor"), ["SWEEP", "FLOOR"]);
  // ...and the production function keeps only the first, which is the point.
  assert.equal(executionRouteKey({ alert_rule: "SweepsFollowedByFloor" }), "SWEEP");
  assert.deepEqual(routeKeyMatches("RepeatedHits"), []);
  assert.equal(executionRouteKey({ alert_rule: "RepeatedHits" }), "OTHER");
  assert.deepEqual(routeKeyMatches(null), []);
  assert.equal(executionRouteKey({ alert_rule: null }), "OTHER");
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

test("signalEligible: only Group A rows can ever fire velocity/split", () => {
  assert.equal(signalEligible(rowA()), true);
  assert.equal(signalEligible(rowB()), false);
});

test("signalEligibility reports the denominator alongside the rate", () => {
  const rows = [rowA(), rowA(), rowB(), rowB(), rowB()];
  const e = signalEligibility(rows);
  assert.deepEqual(e, { total: 5, eligible: 2, ineligible: 3, eligible_pct: 40 });
});

test("signalEligibility returns a null rate on an empty population, not 0%", () => {
  assert.equal(signalEligibility([]).eligible_pct, null);
});
