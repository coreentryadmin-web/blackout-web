import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtMoney, fmtEps, period } from "./meridian-earnings-estimates-format";

test("fmtMoney: re-exports the shared, fixed revenue formatter (see meridian-revenue-format.test.ts for the full boundary coverage)", () => {
  assert.equal(fmtMoney(850_000_000), "$850M");
  // The round-400 fix this re-export carries: a value that rounds to 1000M promotes to B.
  assert.equal(fmtMoney(999_600_000), "$1.00B");
});

test("fmtEps: plain 2dp, no unit tier to overflow", () => {
  assert.equal(fmtEps(1.4), "1.40");
  assert.equal(fmtEps(-0.08), "-0.08");
});

test("period: prefers fiscal_period+fiscal_year, falls back to report_date, then em dash", () => {
  assert.equal(period({ fiscal_period: "Q3", fiscal_year: 2026 }), "Q3 '26");
  assert.equal(period({ fiscal_period: "Q3", fiscal_year: null }), "Q3");
  assert.equal(period({ report_date: "2026-08-20" }), "26-08-20");
  assert.equal(period({}), "—");
});
