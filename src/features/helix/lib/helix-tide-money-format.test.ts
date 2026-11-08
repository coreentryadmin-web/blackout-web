import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtMoney } from "./helix-tide-money-format";

/** The shipped (pre-fix) formatter, kept here so the test can show what it actually did. */
function oldFmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

test("the shipped defect: K never promotes to M when rounding crosses $1,000,000", () => {
  // 999,600 is < 1,000,000 so the OLD code took the K branch, then (999600/1000).toFixed(0)
  // rounded UP to "1000" — rendering the literal, wrong "$1000K".
  assert.equal(oldFmtMoney(999_600), "$1000K", "reproduces the shipped overflow");
  // Promotion renders from the M unit's own precision (0 decimals, matching the M branch
  // elsewhere in this formatter) — not a fabricated extra decimal.
  assert.equal(fmtMoney(999_600), "$1M", "fixed formatter promotes to M instead");
});

test("the shipped defect, one tier up: M never promotes to B when rounding crosses $1,000,000,000", () => {
  // 999,600,000 is < 1,000,000,000 so the OLD code took the M branch, then
  // (999600000/1_000_000).toFixed(0) rounded UP to "1000" — rendering "$1000M".
  assert.equal(oldFmtMoney(999_600_000), "$1000M", "reproduces the shipped overflow, one tier up");
  assert.equal(fmtMoney(999_600_000), "$1.0B", "fixed formatter promotes to B instead");
});

test("ordinary values in each unit are unaffected", () => {
  assert.equal(fmtMoney(500), "$500");
  assert.equal(fmtMoney(4_200), "$4K");
  assert.equal(fmtMoney(430_000), "$430K");
  assert.equal(fmtMoney(6_500_000), "$7M");
  assert.equal(fmtMoney(2_300_000_000), "$2.3B");
});

test("values already at/above a round boundary still render correctly", () => {
  assert.equal(fmtMoney(1_000_000), "$1M");
  assert.equal(fmtMoney(1_000_000_000), "$1.0B");
});
