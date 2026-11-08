import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtCompactRevenue, fmtCompactRevenueOrDash } from "./meridian-revenue-format";

test("fmtCompactRevenue: ordinary values render in their natural unit", () => {
  assert.equal(fmtCompactRevenue(4200), "$4200");
  assert.equal(fmtCompactRevenue(850_000_000), "$850M");
  assert.equal(fmtCompactRevenue(2_300_000_000), "$2.30B");
  // Sign stays attached to the signed number inside the "$" (`$${n...}`), matching the
  // formatter's own template literal in both the original EstimatesPanel/EarningsTabs copies.
  assert.equal(fmtCompactRevenue(-650_000_000), "$-650M");
});

test("fmtCompactRevenue: a value that ROUNDS to 1000M promotes to B instead of overflowing", () => {
  // $999,600,000 is < 1e9 so the naive (pre-fix) implementation takes the M branch, then
  // (999_600_000 / 1e6).toFixed(0) rounds UP to "1000" -- "$1000M" instead of "$1.00B".
  assert.equal(fmtCompactRevenue(999_600_000), "$1.00B");
  // Same defect, negative sign.
  assert.equal(fmtCompactRevenue(-999_600_000), "$-1.00B");
  // Just under the rounding boundary: must NOT promote.
  assert.equal(fmtCompactRevenue(999_400_000), "$999M");
});

test("fmtCompactRevenue: non-finite input is an honest em-dash, not '$NaN'", () => {
  assert.equal(fmtCompactRevenue(NaN), "—");
  assert.equal(fmtCompactRevenue(Infinity), "—");
});

test("fmtCompactRevenueOrDash: null/undefined render as em-dash; a real value delegates to the fixed formatter", () => {
  assert.equal(fmtCompactRevenueOrDash(null), "—");
  assert.equal(fmtCompactRevenueOrDash(undefined), "—");
  assert.equal(fmtCompactRevenueOrDash(999_600_000), "$1.00B");
});
