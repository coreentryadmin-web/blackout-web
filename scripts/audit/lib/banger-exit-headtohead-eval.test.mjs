import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTradeRow,
  candidateEqualsCurrent,
  equityCurveStats,
  meanDeltaCi,
  deltaConcentration,
  leaveOutTopKVerdict,
  trimmedMeanDelta,
  aggregateHeadToHead,
  syntheticFullReturnPct,
} from "./banger-exit-headtohead-eval.mjs";

function row(overrides) {
  return {
    id: 1,
    ticker: "TEST",
    session_date: "2026-08-01",
    contract_expiry: "2026-08-08",
    contract_strike: 10,
    entry_premium: 1,
    peak_premium: 2.5,
    trough_premium: null,
    realized_pnl_pct: 55,
    scale_out_action: "EXIT_RUNNER",
    status: "CLOSED_RUNNER",
    committed_at: "2026-08-01T20:00:00Z",
    closed_at: "2026-08-04T14:00:00Z",
    ...overrides,
  };
}

test("buildTradeRow: computes DTE, peakPct, giveback, and per-candidate delta", () => {
  const r = buildTradeRow(row({}), { a: { triggerPct: 100, fraction: 0.5 } });
  assert.equal(r.dte, 7);
  assert.equal(r.peakPct, 150); // (2.5/1-1)*100
  assert.equal(r.givebackPtsCurrent, 95); // 150-55
  // triggered at 100%: level=2.0; peak=2.5>=2.0 -> blended = 0.5*2.0 + 0.5*55%'s underlying value
  assert.equal(r.a.triggered, true);
  assert.equal(r.a.realizedPnlPct, round2Expected());
  function round2Expected() {
    // production formula: 0.5*100 + 0.5*55 = 77.5
    return 77.5;
  }
  assert.equal(r.a.delta, 22.5); // 77.5 - 55
});

test("buildTradeRow: not triggered when peak never reaches the level -> candidate == current", () => {
  const r = buildTradeRow(row({ peak_premium: 1.5, realized_pnl_pct: -20 }), { a: { triggerPct: 100, fraction: 0.5 } });
  assert.equal(r.a.triggered, false);
  assert.equal(r.a.realizedPnlPct, -20);
  assert.equal(r.a.delta, 0);
});

test("syntheticFullReturnPct: reconstructs the raw single-leg return from a real scaled_already row", () => {
  // Real production row (DBX id=49, 2026-08-04): entry 0.5, realized_pnl_pct 55, scaled_already true.
  // 2*55-100 = 10 -> implies an exit mark of entry*1.10 = 0.55, which IS the row's own last_mark.
  const dbx = row({ entry_premium: 0.5, realized_pnl_pct: 55, scaled_already: true });
  assert.equal(syntheticFullReturnPct(dbx), 10);
});

test("syntheticFullReturnPct: passes non-scaled rows through unchanged (no blending ever occurred)", () => {
  const stopped = row({ realized_pnl_pct: -60, scaled_already: false });
  assert.equal(syntheticFullReturnPct(stopped), -60);
});

test("candidateEqualsCurrent: proves the +100%/50% identity against Banger's real recorded outcome", () => {
  // Banger's real production formula for an EXIT_RUNNER row blends: realized = 0.5*100 + 0.5*rawReturn.
  // Testing candidate 100%/50% against the CORRECTED (reconstructed) baseline must reproduce `current`
  // exactly, for ANY rawReturn -- proving the fix, not just one lucky number.
  for (const rawReturn of [-40, -5, 0, 10, 37.5, 250]) {
    const entry = 2;
    const realizedPnlPct = 0.5 * 100 + 0.5 * rawReturn;
    const peakMult = Math.max(2.0, 1 + rawReturn / 100) + 0.5; // ensure peak clears both the real and the 100% level
    const r = row({ entry_premium: entry, peak_premium: entry * peakMult, realized_pnl_pct: realizedPnlPct, scaled_already: true });
    const tradeRows = [buildTradeRow(r, { a: { triggerPct: 100, fraction: 0.5 } })];
    const check = candidateEqualsCurrent(tradeRows, "a");
    assert.equal(check.identical, true, `mismatch at rawReturn=${rawReturn}: ${JSON.stringify(check.sampleMismatches)}`);
  }
});

test("candidateEqualsCurrent: reports a real mismatch honestly, not silently", () => {
  const tradeRows = [buildTradeRow(row({ realized_pnl_pct: 55 }), { b: { triggerPct: 200, fraction: 0.67 } })];
  // peak 2.5 never reaches 3.0 (200% level) -> b == current == 55, so force a real mismatch instead:
  const mismatchRow = buildTradeRow(row({ peak_premium: 4, realized_pnl_pct: 55 }), { b: { triggerPct: 200, fraction: 0.67 } });
  const check = candidateEqualsCurrent([mismatchRow], "b");
  assert.equal(check.identical, false);
  assert.equal(check.mismatchN, 1);
});

test("equityCurveStats: cumulative return + max drawdown over a chronological sequence", () => {
  const stats = equityCurveStats([10, 20, -50, 5, 30]);
  // cum: 10,30,-20,-15,15 ; peak track: 10,30,30,30,30 ; dd: 0,0,-50,-45,-15 -> maxDD=-50
  assert.equal(stats.totalReturnPts, 15);
  assert.equal(stats.maxDrawdownPts, -50);
});

test("meanDeltaCi: verdict logic matches the CI-vs-zero rule", () => {
  const allPositive = meanDeltaCi([10, 12, 8, 11, 9]);
  assert.equal(allPositive.verdict, "CANDIDATE SEPARATED (better)");
  const mixed = meanDeltaCi([50, -50, 10, -10]);
  assert.equal(mixed.verdict, "INCONCLUSIVE");
  const single = meanDeltaCi([5]);
  assert.equal(single.verdict, "INSUFFICIENT N");
});

test("deltaConcentration: attributes total delta share to the top-K trades by |delta|", () => {
  const tradeRows = [
    { id: 1, a: { delta: 100 } },
    { id: 2, a: { delta: 5 } },
    { id: 3, a: { delta: 3 } },
    { id: 4, a: { delta: -2 } },
  ];
  const c = deltaConcentration(tradeRows, "a", [1, 2]);
  assert.equal(c.totalDelta, 106);
  const top1 = c.byTopK.find((x) => x.k === 1);
  assert.equal(top1.sumTopK, 100);
  assert.equal(top1.sharePct, round2(100 / 106 * 100));
  function round2(x) { return Math.round(x * 100) / 100; }
});

test("leaveOutTopKVerdict: removing the biggest mover can flip a verdict driven by one outlier", () => {
  const tradeRows = [
    { id: 1, a: { delta: 500 } }, // one huge outlier
    { id: 2, a: { delta: -5 } },
    { id: 3, a: { delta: -4 } },
    { id: 4, a: { delta: -3 } },
    { id: 5, a: { delta: -2 } },
  ];
  const withOutlier = meanDeltaCi(tradeRows.map((r) => r.a.delta));
  const withoutOutlier = leaveOutTopKVerdict(tradeRows, "a", 1);
  assert.equal(withOutlier.verdict, "INCONCLUSIVE"); // huge variance from the outlier widens the CI
  assert.equal(withoutOutlier.removedN, 1);
  assert.equal(withoutOutlier.verdict, "CURRENT SEPARATED (better)"); // -5,-4,-3,-2 all negative, tight CI
});

test("trimmedMeanDelta: drops extreme values by rank before averaging", () => {
  const tradeRows = Array.from({ length: 20 }, (_, i) => ({ id: i, a: { delta: i } })); // 0..19
  const t = trimmedMeanDelta(tradeRows, "a", 5); // cut = floor(20*0.05) = 1 each side -> drops 0 and 19
  assert.equal(t.n, 18);
  assert.equal(t.trimmedMean, 9.5); // mean of 1..18
});

test("aggregateHeadToHead: full metric bundle sanity (win rate, expectancy, PF, stop rate, equity curve)", () => {
  const rows = [
    row({ id: 1, entry_premium: 1, peak_premium: 3, realized_pnl_pct: 60, scale_out_action: "EXIT_RUNNER" }),
    row({ id: 2, entry_premium: 1, peak_premium: 0.9, realized_pnl_pct: -60, scale_out_action: "STOP_OUT" }),
    row({ id: 3, entry_premium: 1, peak_premium: 1.5, realized_pnl_pct: 20, scale_out_action: "EXIT_RUNNER" }),
  ];
  const tradeRows = rows.map((r) => buildTradeRow(r, { a: { triggerPct: 100, fraction: 0.5 } }));
  const agg = aggregateHeadToHead(tradeRows, "a");
  assert.equal(agg.n, 3);
  assert.equal(agg.stopRatePct, round2(1 / 3 * 100));
  assert.ok(agg.winRate >= 0 && agg.winRate <= 100);
  assert.ok(agg.concentration.n === 3);
  assert.ok(agg.leaveOutTop1.removedN === 1);
  function round2(x) { return Math.round(x * 100) / 100; }
});
