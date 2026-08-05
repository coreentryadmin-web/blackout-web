import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconstructMidGrade,
  isOfficialGraded,
  officialWinLabel,
  evaluatePlayAgreement,
} from "./grading-agreement-eval.mjs";

// The REAL production predicate (feature-store.ts labelFromPlanOutcome) — imported, not
// reimplemented, so this test asserts against the actual shipped invariant.
const { labelFromPlanOutcome } = await import(
  new URL("../../../src/lib/zerodte/feature-store.ts", import.meta.url).pathname
);

test("reconstructMidGrade: legacy row (no executable blob) — mid === official (by fallback construction)", () => {
  const play = { plan_outcome: "doubled", plan_pnl_pct: 100, entry_context: null };
  assert.deepEqual(reconstructMidGrade(play), { outcome: "doubled", pnlPct: 100, source: "legacy_fallback" });
});

test("reconstructMidGrade: WS-10 row reads the TRUE raw mid off entry_context.executable.mid_plan_*", () => {
  const play = {
    plan_outcome: "stopped", // OFFICIAL (executable-lane) — /record's resolved field
    plan_pnl_pct: -50,
    entry_context: {
      executable: { mid_plan_outcome: "time_stop", mid_plan_pnl_pct: 12.5, plan_outcome: "stopped", plan_pnl_pct: -50 },
    },
  };
  assert.deepEqual(reconstructMidGrade(play), { outcome: "time_stop", pnlPct: 12.5, source: "executable_blob" });
});

test("isOfficialGraded / officialWinLabel mirror record.ts isGradedZeroDteRow / isZeroDteWin", () => {
  assert.equal(isOfficialGraded({ plan_outcome: "doubled", plan_pnl_pct: 100 }), true);
  assert.equal(isOfficialGraded({ plan_outcome: "ungradeable", plan_pnl_pct: null }), false);
  assert.equal(isOfficialGraded({ plan_outcome: null, plan_pnl_pct: 10 }), false);
  assert.equal(officialWinLabel({ plan_pnl_pct: 0.01 }), "win");
  assert.equal(officialWinLabel({ plan_pnl_pct: 0 }), "loss");
  assert.equal(officialWinLabel({ plan_pnl_pct: -5 }), "loss");
});

test("evaluatePlayAgreement: legacy row — the two graders can never disagree (mid IS official)", () => {
  const play = { ticker: "SPY", session_date: "2026-08-01", plan_outcome: "time_stop", plan_pnl_pct: 3.2, entry_context: null };
  const v = evaluatePlayAgreement(play, labelFromPlanOutcome);
  assert.equal(v.feature_store_label, "win");
  assert.equal(v.record_label, "win");
  assert.equal(v.agree, true);
});

test("evaluatePlayAgreement: THE DISAGREEMENT CASE — WS-10 row where mid is a green time_stop but the executable grade stopped out", () => {
  // Real shape: gradePlanFromBars (mid) rode a time_stop at +12.5%; gradePlanExecutableFromBars
  // (executable) latched the stop earlier on the bid-side walk (WS-10 doc: "every executable
  // return is <= its mid twin") and booked -50%. feature-store.ts labels off the mid (a win);
  // record.ts labels off the official/executable (a loss) — the comment-only invariant breaks.
  const play = {
    ticker: "TSLA",
    session_date: "2026-07-30",
    plan_outcome: "stopped", // official/executable
    plan_pnl_pct: -50,
    entry_context: {
      executable: {
        mid_plan_outcome: "time_stop",
        mid_plan_pnl_pct: 12.5,
        plan_outcome: "stopped",
        plan_pnl_pct: -50,
      },
    },
  };
  const v = evaluatePlayAgreement(play, labelFromPlanOutcome);
  assert.equal(v.feature_store_label, "win");
  assert.equal(v.record_label, "loss");
  assert.equal(v.both_graded, true);
  assert.equal(v.agree, false);
});

test("evaluatePlayAgreement: ungradeable official row — record has no label, feature-store's own SQL filter would have excluded it anyway (not evidence either side)", () => {
  const play = { ticker: "QQQ", session_date: "2026-07-29", plan_outcome: "ungradeable", plan_pnl_pct: null, entry_context: null };
  const v = evaluatePlayAgreement(play, labelFromPlanOutcome);
  assert.equal(v.feature_store_label, null);
  assert.equal(v.record_label, null);
  assert.equal(v.both_graded, false);
  assert.equal(v.agree, null);
});

test("evaluatePlayAgreement: breakeven (pnl exactly 0) — both graders call it a loss (labelFromPlanOutcome's own >0 rule, not >=0)", () => {
  const play = { ticker: "IWM", session_date: "2026-07-28", plan_outcome: "time_stop", plan_pnl_pct: 0, entry_context: null };
  const v = evaluatePlayAgreement(play, labelFromPlanOutcome);
  assert.equal(v.feature_store_label, "loss");
  assert.equal(v.record_label, "loss");
  assert.equal(v.agree, true);
});
