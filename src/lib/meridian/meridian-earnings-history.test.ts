import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { MeridianEarningsPrint } from "@/features/meridian/lib/meridian-types";

// meridian-earnings-history.ts pulls in a real `import "server-only"`, which throws under plain
// Node outside a Next.js server bundle. Stub it the same way the rest of the repo's tests do.
mock.module("server-only", { namedExports: {} });

const mod = () => import("./meridian-earnings-history");

function print(over: Partial<MeridianEarningsPrint>): MeridianEarningsPrint {
  return {
    report_date: "2026-01-01",
    report_time_et: null,
    reaction_basis: "bmo_session",
    reaction_pct: null,
    reaction_measure: null,
    reaction_settled: true,
    reaction_includes_prior_drift: null,
    eps_estimate: 1,
    eps_actual: 1,
    revenue_estimate: null,
    revenue_actual: null,
    revenue_surprise_pct: null,
    surprise_pct: 0,
    beat: true,
    source: null,
    expected_move_pct: null,
    session_change_pct: null,
    next_day_change_pct: null,
    ...over,
  };
}

test("printHistorySummary excludes a still-forming (unsettled) reaction from the average", async () => {
  // Regression: three real settled reactions average to +0.67%, but a same-day print still
  // moving at -9.4% (reaction_settled: false) used to get pooled in unconditionally, flipping
  // the sign to roughly -1.9% -- the exact "launders an unknown into a statistic" defect
  // settledReactions() exists to prevent, already applied by the sibling summarizePeerReaction
  // and MeridianEarningsHistoryPanel's own chart but missing here.
  const { printHistorySummary } = await mod();
  const rows: MeridianEarningsPrint[] = [
    print({ reaction_pct: 3.0, reaction_settled: true }),
    print({ reaction_pct: -2.0, reaction_settled: true }),
    print({ reaction_pct: 1.0, reaction_settled: true }),
    print({ reaction_pct: -9.4, reaction_settled: false }),
  ];
  const summary = printHistorySummary(rows);
  assert.ok(summary);
  assert.match(summary!, /avg reaction \+0\.7%/, `expected the settled-only average, got: ${summary}`);
});

test("printHistorySummary excludes an assumed-report-session reaction from the average", async () => {
  const { printHistorySummary } = await mod();
  const rows: MeridianEarningsPrint[] = [
    print({ reaction_pct: 4.0, reaction_settled: true, reaction_basis: "bmo_session" }),
    print({ reaction_pct: -20.0, reaction_settled: true, reaction_basis: "assumed_report_session" }),
  ];
  const summary = printHistorySummary(rows);
  assert.ok(summary);
  assert.match(summary!, /avg reaction \+4\.0%/, `expected only the non-assumed print counted, got: ${summary}`);
});

test("printHistorySummary still reports a plain settled average unaffected by the fix", async () => {
  const { printHistorySummary } = await mod();
  const rows: MeridianEarningsPrint[] = [
    print({ reaction_pct: 2.0, reaction_settled: true }),
    print({ reaction_pct: -6.0, reaction_settled: true }),
  ];
  const summary = printHistorySummary(rows);
  assert.ok(summary);
  assert.match(summary!, /avg reaction -2\.0%/);
});
