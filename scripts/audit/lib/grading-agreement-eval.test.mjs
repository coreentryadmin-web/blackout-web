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

test("evaluatePlayAgreement: the once-divergent WS-10 shape now AGREES — and the third argument is why", () => {
  // This case used to assert a DISAGREEMENT, and that assertion was correct when written: pre-NH-R14,
  // feature-store.ts decided win/loss from the mid columns alone, so a row whose mid rode a green
  // time_stop (+12.5%) while the executable walk stopped out (-50%) genuinely split the two graders.
  //
  // NH-R14 fixed it — labelFromPlanOutcome now delegates to record.ts's isZeroDteWin over an
  // OfficialGradableRow, and feature-store.ts:112 passes entryContext. But THIS HARNESS kept calling
  // it with two arguments, so it forced the mid-only fallback and kept reporting the pre-fix result
  // against post-fix code: a live 90-day run still showed "4 disagreements" that no longer existed.
  //
  // The test now pins the fixed behaviour AND the reason it holds.
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
  assert.equal(v.feature_store_label, "loss", "production call resolves the OFFICIAL lane");
  assert.equal(v.record_label, "loss");
  assert.equal(v.both_graded, true);
  assert.equal(v.agree, true, "the invariant holds once the call site is faithful");

  // Load-bearing: this row agrees ONLY because entry_context is passed. If a refactor drops that
  // argument the label flips back to the mid answer — which is exactly the regression to catch.
  assert.equal(v.mid_only_label, "win", "the mid-only answer is still a win — the divergence is real, just no longer reached");
  assert.equal(v.mid_only_would_differ, true, "flags the rows where the third argument decides the label");
});

test("evaluatePlayAgreement: a legacy row is NOT flagged load-bearing — mid IS official there", () => {
  // Pre-WS10 rows have no executable blob, so mid and official are the same number and dropping
  // entry_context changes nothing. Flagging these would drown the real signal.
  const play = { ticker: "SPY", session_date: "2026-07-10", plan_outcome: "doubled", plan_pnl_pct: 100, entry_context: null };
  const v = evaluatePlayAgreement(play, labelFromPlanOutcome);
  assert.equal(v.agree, true);
  assert.equal(v.mid_only_would_differ, false);
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
