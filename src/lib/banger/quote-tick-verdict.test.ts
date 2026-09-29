import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveScaleOutAction, SCALE_OUT_RULES } from "@/lib/zerodte/scale-out";
import {
  CONTROL_RULES,
  CANDIDATE_RULES,
  replayTickState,
  replayPairTick,
  crossCheckScaledFlag,
  median,
  equityCurveStats,
  meanDeltaCi,
  aggregateVerdict,
  type ReplayTick,
} from "./quote-tick-verdict";

describe("CONTROL_RULES matches the REAL production SCALE_OUT_RULES exactly", () => {
  test("byte-identical to src/lib/zerodte/scale-out.ts's SCALE_OUT_RULES", () => {
    assert.deepEqual(CONTROL_RULES, SCALE_OUT_RULES);
  });
});

/** Replicates live-sync.ts's real per-tick loop: peak = Math.max(priorPeak, mark), computed
 *  INCLUSIVE of the current tick, before deriveScaleOutAction is called -- the same oracle-parity
 *  discipline the original .mjs module's own test file established. */
function driveRealProductionLoop(ticks: ReplayTick[], entryPremium: number): { action: string; exitMark: number | null; scaled: boolean } {
  let peak = entryPremium;
  let scaledAlready = false;
  for (const tick of ticks) {
    const mark = tick.mark;
    peak = Math.max(peak, mark);
    const { action } = deriveScaleOutAction({ entryPremium, peakPremium: peak, lastMark: mark, scaledAlready });
    if (action === "TAKE_PARTIAL") scaledAlready = true;
    if (action === "EXIT_RUNNER" || action === "STOP_OUT") {
      return { action, exitMark: mark, scaled: scaledAlready };
    }
  }
  return { action: "HOLD", exitMark: null, scaled: scaledAlready };
}

describe("replayTickState -- oracle parity against the REAL deriveScaleOutAction", () => {
  test("hard stop: exits at the fixed entry*hard_stop_mult level, matches real production's exit cause", () => {
    const ticks: ReplayTick[] = [
      { t: 0, mark: 1.0, bid: 1.0 },
      { t: 1, mark: 0.8, bid: 0.8 },
      { t: 2, mark: 0.39, bid: 0.39 }, // below 0.4 * 1.0 hard stop
    ];
    const real = driveRealProductionLoop(ticks, 1.0);
    const replay = replayTickState(ticks, 1.0, CONTROL_RULES);
    assert.equal(real.action, "STOP_OUT");
    assert.equal(replay.exitCause, "hard_stop");
    assert.equal(replay.scaled, false);
  });

  test("scale + trail runner: matches real production's scale-then-trail-exit sequence", () => {
    const ticks: ReplayTick[] = [
      { t: 0, mark: 1.0, bid: 1.0 },
      { t: 1, mark: 2.1, bid: 2.1 }, // triggers TAKE_PARTIAL (2x)
      { t: 2, mark: 3.0, bid: 3.0 }, // new peak
      { t: 3, mark: 1.49, bid: 1.49 }, // below 0.5 * peak(3.0) = 1.5 -> trail exit
    ];
    const real = driveRealProductionLoop(ticks, 1.0);
    const replay = replayTickState(ticks, 1.0, CONTROL_RULES);
    assert.equal(real.action, "EXIT_RUNNER");
    assert.equal(replay.exitCause, "trail_stop");
    assert.equal(replay.scaled, true);
    // production's REAL formula: EXIT_RUNNER prices at the tick's ACTUAL mark, not the theoretical trail level
    assert.equal(replay.modelRealizedMultiple, (0.5 * (1.0 * 2.0) + 0.5 * 1.49) / 1.0);
  });

  test("no trigger at all: rides to series end at the last observed mark", () => {
    const ticks: ReplayTick[] = [
      { t: 0, mark: 1.0, bid: 1.0 },
      { t: 1, mark: 1.1, bid: 1.1 },
      { t: 2, mark: 0.9, bid: 0.9 },
    ];
    const replay = replayTickState(ticks, 1.0, CONTROL_RULES);
    assert.equal(replay.exitCause, "series_end_never_triggered");
    assert.equal(replay.scaled, false);
    assert.equal(replay.modelRealizedMultiple, 0.9);
  });

  test("no data / non-positive entry: HOLD-equivalent identity result, never throws", () => {
    assert.equal(replayTickState([], 1.0, CONTROL_RULES).exitCause, "no_data");
    assert.equal(replayTickState([{ t: 0, mark: 1, bid: 1 }], 0, CONTROL_RULES).exitCause, "no_data");
  });
});

describe("MODEL vs EXEC fill tracks", () => {
  test("EXEC fill is capped at the tick's own bid, never priced better than the model fill", () => {
    const ticks: ReplayTick[] = [{ t: 0, mark: 0.39, bid: 0.3 }]; // hard stop, model fills at 0.4, bid is worse at 0.3
    const r = replayTickState(ticks, 1.0, CONTROL_RULES);
    assert.equal(r.modelRealizedMultiple, 0.4);
    assert.equal(r.execRealizedMultiple, 0.3);
  });

  test("EXEC fill equals model fill when bid is AT or better than the model price (never improves past it)", () => {
    const ticks: ReplayTick[] = [{ t: 0, mark: 0.39, bid: 0.5 }]; // bid better than the 0.4 model fill -> capped at 0.4
    const r = replayTickState(ticks, 1.0, CONTROL_RULES);
    assert.equal(r.modelRealizedMultiple, 0.4);
    assert.equal(r.execRealizedMultiple, 0.4);
  });
});

describe("replayPairTick", () => {
  test("runs control and candidate against the identical tick series and reports both deltas", () => {
    const ticks: ReplayTick[] = [
      { t: 0, mark: 1.0, bid: 1.0 },
      { t: 1, mark: 2.1, bid: 2.1 },
      { t: 2, mark: 3.0, bid: 3.0 },
      { t: 3, mark: 1.4, bid: 1.4 }, // below control's 1.5 trail AND candidate's 0.7*3=2.1 trail
    ];
    const pair = replayPairTick(ticks, 1.0, CONTROL_RULES, CANDIDATE_RULES);
    assert.equal(pair.control.exitCause, "trail_stop");
    assert.equal(pair.candidate.exitCause, "trail_stop");
    assert.ok(pair.modelDelta !== null);
  });
});

describe("crossCheckScaledFlag -- the partial-fill safeguard", () => {
  test("matches when the CONTROL replay's own scaled flag agrees with the recorded DB state", () => {
    assert.deepEqual(crossCheckScaledFlag(true, true), { matches: true, replayScaled: true, recordedScaledAlready: true, reason: null });
    assert.deepEqual(crossCheckScaledFlag(false, false), { matches: true, replayScaled: false, recordedScaledAlready: false, reason: null });
  });

  test("flags a disagreement -- the reconstructed trade is not the real one, even with FULL tick coverage", () => {
    const r = crossCheckScaledFlag(false, true); // replay never saw the scale-out the DB recorded
    assert.equal(r.matches, false);
    assert.ok(r.reason && r.reason.includes("false") && r.reason.includes("true"));
  });

  test("flags the opposite disagreement too", () => {
    const r = crossCheckScaledFlag(true, false); // replay thinks it scaled but the DB never recorded one
    assert.equal(r.matches, false);
    assert.ok(r.reason !== null);
  });
});

describe("stats helpers", () => {
  test("median: even and odd counts, ignores non-finite", () => {
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([1, NaN, 3]), 2);
    assert.equal(median([]), null);
  });

  test("equityCurveStats: cumulative return + max peak-to-trough drawdown", () => {
    const s = equityCurveStats([10, -5, 20, -30, 5]);
    assert.equal(s.totalReturnPts, 0); // 10-5+20-30+5 = 0
    assert.equal(s.maxDrawdownPts, -30); // peak 25 (after 10-5+20), trough -5 (after -30) -> -30
  });

  test("meanDeltaCi: verdict follows whether the 95% CI excludes zero", () => {
    const consistent = meanDeltaCi([10, 11, 9, 10.5, 9.5]);
    assert.equal(consistent.verdict, "CANDIDATE SEPARATED (better)");
    const single = meanDeltaCi([5]);
    assert.equal(single.verdict, "INSUFFICIENT N");
    assert.equal(single.n, 1);
  });
});

describe("aggregateVerdict", () => {
  test("computes win rate / expectancy / profit factor / medians over usable rows", () => {
    const agg = aggregateVerdict([
      { id: 1, ticker: "AAA", current: 10, cand: { realizedPnlPct: 20, delta: 10 } },
      { id: 2, ticker: "BBB", current: -30, cand: { realizedPnlPct: -20, delta: 10 } },
    ]);
    assert.equal(agg.n, 2);
    assert.equal(agg.winRate, 50);
    assert.equal(agg.expectancy, 0);
    assert.equal(agg.medianCurrent, -10);
    assert.equal(agg.medianCandidate, 0);
  });

  test("NO DATA on an empty population", () => {
    assert.deepEqual(aggregateVerdict([]), { n: 0, verdict: "NO DATA" });
  });
});
