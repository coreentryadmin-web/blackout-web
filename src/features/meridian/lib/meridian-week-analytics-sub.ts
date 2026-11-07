/**
 * The Meridian desk's "universe chip" subtitle — "12/40 printed · rev beat 62% of 96 prints".
 *
 * BUG THIS FIXES (found 2026-11-07): the revenue-beat clause is gated on `eps_beat_rate`
 * being non-null, not on `revenue_beat_rate` itself. `dualBeatRateFromPrints`
 * (meridian-benzinga-earnings-core.ts) computes `eps_beat_rate` and `revenue_beat_rate` from
 * two INDEPENDENT cohorts (`eps_graded` = prints with a gradeable EPS surprise,
 * `revenue_graded` = prints with a gradeable revenue surprise) — that function's own doc
 * comment: "of 4,484 names carrying both rates ... 52 (1.2%) have one side at <=2 while the
 * other is >=6", i.e. it is a normal, live case for one side to be null (zero graded prints)
 * while the other is populated.
 *
 * The original gate (PR #2513, which first added this function while fixing a *different*
 * cohort-mismatch bug in the same string) checked the wrong field: whenever `eps_beat_rate`
 * is null — including when `revenue_beat_rate` is perfectly healthy — the function returns
 * bare `"N/M printed"` and silently drops the revenue-beat clause the universe chip exists to
 * show. A real revenue-beat rate is suppressed by an unrelated EPS gap, the same "a shared
 * gate used for the wrong measure" shape as the sibling fix in
 * `meridian-beat-rate-display.ts` (#7508) — reusing one field's null-ness as a proxy for
 * another's availability.
 *
 * Fix: gate strictly on `revenue_beat_rate` itself. `eps_beat_rate` plays no role in whether
 * the revenue clause renders.
 */
export type MeridianWeekAnalyticsSubInput = {
  printed_this_week: number;
  names_count: number;
  eps_beat_rate: number | null;
  revenue_beat_rate: number | null;
  revenue_graded?: number;
};

export function weekAnalyticsSub(a: MeridianWeekAnalyticsSubInput): string {
  const printed = `${a.printed_this_week}/${a.names_count} printed`;
  // Neither rate has anything to show — bare cohort count only, same as before.
  if (a.revenue_beat_rate == null && a.eps_beat_rate == null) return printed;
  // Revenue specifically has nothing gradeable (whether or not EPS does) — say so honestly,
  // never silently drop the clause because an unrelated field (EPS) happens to be null.
  if (a.revenue_beat_rate == null) return `${printed} · rev beat —`;
  const of = a.revenue_graded && a.revenue_graded > 0 ? ` of ${a.revenue_graded} prints` : "";
  return `${printed} · rev beat ${Math.round(a.revenue_beat_rate * 100)}%${of}`;
}
