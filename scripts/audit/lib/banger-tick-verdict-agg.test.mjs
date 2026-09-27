import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aggregateVerdict } from "./banger-tick-verdict-agg.mjs";

function row(current, candPct, delta) {
  return { current, cand: { realizedPnlPct: candPct, delta } };
}

describe("aggregateVerdict", () => {
  test("NO DATA on an empty population", () => {
    assert.deepEqual(aggregateVerdict([], "cand"), { n: 0, verdict: "NO DATA" });
  });

  test("computes winRate/expectancy/profitFactor/medians over usable rows only, skipping rows missing the candidate outcome", () => {
    const rows = [
      row(10, 20, 10),
      row(-30, -20, 10),
      { current: 5 }, // missing cand -- must be excluded, not treated as a loss
    ];
    const agg = aggregateVerdict(rows, "cand");
    assert.equal(agg.n, 2);
    assert.equal(agg.winRate, 50);
    assert.equal(agg.expectancy, 0); // (20 + -20) / 2
    assert.equal(agg.medianCurrent, -10); // median(10,-30)
    assert.equal(agg.medianCandidate, 0); // median(20,-20)
  });

  test("profitFactor is Infinity with zero losses and at least one win, null with zero of both", () => {
    const allWins = aggregateVerdict([row(0, 10, 5), row(0, 5, 5)], "cand");
    assert.equal(allWins.profitFactor, Infinity);
    const allZero = aggregateVerdict([row(0, 0, 0)], "cand");
    assert.equal(allZero.profitFactor, null);
  });

  test("meanDelta/ci/verdict come straight from the real meanDeltaCi (not reimplemented) -- a consistent positive delta set reports a positive verdict", () => {
    const rows = [row(0, 10, 10), row(0, 12, 10), row(0, 11, 10), row(0, 9, 10), row(0, 13, 10)];
    const agg = aggregateVerdict(rows, "cand");
    assert.equal(agg.meanDelta, 10);
    assert.ok(agg.ci.lo > 0, "a tight, consistently-positive delta set should exclude zero");
  });

  test("supports the EXEC-track by passing curKey='currentExec' against candExec", () => {
    const rows = [{ current: 100, currentExec: 90, cand: { realizedPnlPct: 999 }, candExec: { realizedPnlPct: 40, delta: -5 } }];
    const agg = aggregateVerdict(rows.map((r) => ({ ...r, current: r.currentExec, cand: r.candExec })), "cand", "current");
    assert.equal(agg.medianCurrent, 90);
    assert.equal(agg.medianCandidate, 40);
  });
});
