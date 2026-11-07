/**
 * Which "graded" cohort size belongs beside EACH beat-rate bar on the earnings History tab.
 *
 * BUG THIS FIXES (found 2026-11-07): `MeridianEarningsHistoryPanel.tsx` rendered three
 * `RateBar`s — EPS, Revenue, Combined — but computed a SINGLE shared `graded` count
 * (`prints.filter(p => p.beat != null).length`, i.e. the EPS-graded cohort only) and passed
 * that same number as every bar's `n`. `dualBeatRateFromPrints` (meridian-benzinga-earnings-
 * core.ts), which actually produces `eps_beat_rate`/`revenue_beat_rate`/`combined_beat_rate`,
 * grades each on a DIFFERENT, independently-sized cohort:
 *   - `eps_graded`      = prints with a gradeable EPS surprise (`p.beat != null`)
 *   - `revenue_graded`  = prints with a gradeable revenue surprise (`p.revenue_surprise_pct
 *                         != null`) — that file's own doc comment: "of 4,484 names carrying
 *                         both rates, 140 (3.1%) have denominators differing by 3+ prints and
 *                         52 (1.2%) have one side at <=2 while the other is >=6."
 *   - `combined_graded` = the POOLED reading count (eps + revenue gradings, can double-count
 *                         a print graded on both measures) — explicitly NOT a print count.
 *   - `prints_graded`   = distinct prints with >=1 gradeable measure — "the honest 'over N
 *                         prints'" per that file's own comment.
 *
 * `RateBar` hides its bar entirely when `n === 0`, even when `rate` is a valid, non-null
 * number — so reusing the EPS count for the Revenue/Combined bars actively SUPPRESSES a real
 * rate whenever a name has zero EPS-graded prints but one or more revenue-graded prints (a
 * live, non-rare case per the stats above): `rate=0.80, n=0` renders as "—" instead of "80%".
 * When both cohorts are non-empty but merely differ in size, the single shared caption below
 * the three bars ("over N graded prints") silently reports the wrong N for whichever bar(s)
 * it doesn't actually belong to — the exact defect `printHistorySummary` (meridian-earnings-
 * history.ts) already documents and avoids for its own, differently-shaped sentence.
 *
 * Fix: read each bar's own cohort straight off the aggregate `beat_rates` the server already
 * computed (`dualBeatRateFromPrints`), rather than re-deriving a cohort client-side from raw
 * prints and sharing it across all three measures.
 */
export type MeridianBeatRateCohorts = {
  eps_graded?: number | null;
  revenue_graded?: number | null;
  combined_graded?: number | null;
  prints_graded?: number | null;
};

export type MeridianBeatRateCohortCounts = {
  /** `n` for the EPS `RateBar`. */
  eps: number;
  /** `n` for the Revenue `RateBar`. */
  revenue: number;
  /** `n` for the Combined `RateBar` — a pooled reading count, correct as a zero-check but
   *  never printed as "N prints". */
  combined: number;
  /** The honest "over N graded prints" caption count — distinct prints, not pooled readings. */
  captionPrints: number;
};

/** Resolve the per-bar cohort sizes from the server-computed aggregate. Each field defaults
 *  to 0 (not shared with another field) when the aggregate is missing it. */
export function resolveBeatRateCohortCounts(
  rates: MeridianBeatRateCohorts | null | undefined
): MeridianBeatRateCohortCounts {
  return {
    eps: rates?.eps_graded ?? 0,
    revenue: rates?.revenue_graded ?? 0,
    combined: rates?.combined_graded ?? 0,
    captionPrints: rates?.prints_graded ?? 0,
  };
}
