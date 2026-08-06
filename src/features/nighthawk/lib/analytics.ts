import { fetchNighthawkFunnelStats, fetchNighthawkOutcomeAnalytics, type NighthawkPlayOutcomeRow } from "@/lib/db";
import { entryRangeMid } from "@/features/nighthawk/lib/entry-range";
import { REJECTION_TRIGGER_REASON, type NighthawkRejectionDetail } from "@/features/nighthawk/lib/play-outcomes";
import {
  GRADE_METHODOLOGY_CURRENT,
  GRADE_METHODOLOGY_LEGACY,
  gradeMethodologyLabel,
  isCurrentGradeMethodology,
} from "@/features/nighthawk/lib/grade-methodology";
// The one LOW-N disclosure threshold for the whole platform (zerodte/record.ts) — the
// 0DTE record section already badges every n<5 bucket; Night Hawk cuts now carry the
// same flag so no 2-sample bucket can read like a track record on any surface.
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";
// PR-N10: the compact debrief summary (failure-mode counts from the pinned per-play
// post-mortems) served alongside the record. Computed by the shared aggregate module
// so the record route and the full admin debrief report can never disagree on a count.
import {
  summarizeDebriefPins,
  type NighthawkDebriefRecordSummary,
} from "@/features/nighthawk/lib/debrief-aggregate";

// Task #145: funnel/rejection-rate stats. Reverse-indexes REJECTION_TRIGGER_REASON (the single
// source of truth for the 5 rejection-stage strings, play-outcomes.ts) by its TEXT value so a
// `trigger_reason` read back from `alert_audit_log` (already grouped in SQL by
// fetchNighthawkFunnelStats) can be labeled with its short stage slug — no second copy of the
// reason strings, no decision_trace JSON parsing needed just to show which stage a rejection
// came from.
const STAGE_BY_TRIGGER_REASON = new Map<string, NighthawkRejectionDetail["stage"]>(
  (Object.entries(REJECTION_TRIGGER_REASON) as Array<[NighthawkRejectionDetail["stage"], string]>).map(
    ([stage, reason]) => [reason, stage]
  )
);

/** "sector_concentration" -> "Sector concentration". Falls back to the raw slug for a
 *  trigger_reason that doesn't match any known stage (defensive only — every row this reads
 *  was itself written from REJECTION_TRIGGER_REASON's 5 fixed values; see
 *  fetchNighthawkFunnelStats's doc comment). */
function stageLabel(stage: string): string {
  return stage
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type NighthawkFunnelStage = {
  /** Short machine-readable slug, e.g. "premium_cap" — one of NighthawkRejectionDetail["stage"],
   *  or "other" for a trigger_reason this map doesn't recognize (should never happen in practice). */
  stage: string;
  /** Human-readable label for the UI, e.g. "Premium cap". */
  label: string;
  /** The raw, full trigger_reason sentence — shown as a tooltip/detail string. */
  trigger_reason: string;
  n: number;
};

export type NighthawkFunnelStats = {
  window_days: number;
  /** Plays that survived synthesis and were shown to members (nighthawk_play_outcomes rows
   *  in the window — one per edition/ticker). */
  published_count: number;
  /** Plays rejected at any of the 4 synthesis-funnel stages (alert_audit_log rows with
   *  alert_type = 'nighthawk_rejected' in the window). */
  rejected_count: number;
  /** published_count + rejected_count — every candidate that reached a publish/reject decision
   *  this window. NOT the full scored-candidate pool (that count isn't durably logged today). */
  candidates_count: number;
  /** rejected_count / candidates_count. 0 when there were no candidates at all. */
  rejection_rate: number;
  /** Rejected count broken down by stage, sorted by n descending (already sorted in SQL). */
  by_stage: NighthawkFunnelStage[];
};

/** Pure transform from raw funnel counts (db.ts's fetchNighthawkFunnelStats) into the shaped,
 *  labeled stats the admin dashboard renders — split out so it's unit-testable without a DB. */
export function buildNighthawkFunnel(
  windowDays: number,
  publishedCount: number,
  rejectedByReason: Array<{ trigger_reason: string; n: number }>
): NighthawkFunnelStats {
  const by_stage: NighthawkFunnelStage[] = rejectedByReason
    .map((r) => {
      const stage = STAGE_BY_TRIGGER_REASON.get(r.trigger_reason) ?? "other";
      return { stage, label: stageLabel(stage), trigger_reason: r.trigger_reason, n: r.n };
    })
    .sort((a, b) => b.n - a.n);
  const rejected_count = by_stage.reduce((sum, r) => sum + r.n, 0);
  const candidates_count = publishedCount + rejected_count;
  return {
    window_days: windowDays,
    published_count: publishedCount,
    rejected_count,
    candidates_count,
    rejection_rate: candidates_count > 0 ? rejected_count / candidates_count : 0,
    by_stage,
  };
}

/** PR-N2: one grading-rule-set's slice of the record. The two segments (current/legacy)
 *  are reported side by side and NEVER aggregated — a single WR over rows graded under
 *  different rule sets is not a record (§2.1: the blended 42.9% headline vs 11.1% under
 *  current rules on the same history). */
export type NighthawkRecordSegment = {
  /** grade-methodology.ts tag, e.g. "v2_fillability". */
  methodology: string;
  /** Human-readable description of what the rule set graded. */
  label: string;
  /** All resolved rows in this segment (including unfilled/pulled/stop-data-unavailable). */
  resolved: number;
  /** Rows with a realized return worth averaging (excl. unfilled, pulled,
   *  stop-data-unavailable). This is the avg_return/profitable_rate population — it is
   *  deliberately NOT the win-rate denominator: it still contains 'open' and 'ambiguous'
   *  rows, which are not decided outcomes. See `decided`. */
  scoreable: number;
  wins: number;
  losses: number;
  opens: number;
  ambiguous: number;
  unfilled: number;
  pulled: number;
  stop_data_unavailable: number;
  /** WIN-RATE DENOMINATOR = wins + losses. An 'open' grade means the one-session grading
   *  horizon expired with NEITHER the published target nor the stop touched — the play was
   *  never decided, so it is not a loss. Folding opens into the denominator pins the rate at
   *  ~0 by construction (live 2026-08-06: 0 targets / 2 stops / 20 opens rendered a hard,
   *  confident "0% win rate" on a sample with two decided outcomes). Keep this separate from
   *  `scoreable`: exclusion accounting and return averages legitimately span both. */
  decided: number;
  /** null (not a fake 0%) when nothing is decided. */
  win_rate: number | null;
  avg_return_pct: number | null;
  /** decided < LOW_N_THRESHOLD — UIs must badge this; the record must not be read.
   *  Keyed off DECIDED outcomes, never off the size of `scoreable`: a 22-row scoreable set
   *  holding 20 no-touch rows carries exactly 2 outcomes and must badge as thin. */
  low_n: boolean;
};

/** A grouped cut over CURRENT-methodology scoreable rows only (never blended), with the
 *  shared LOW-N flag so every surface badges thin evidence identically. `win_rate` is
 *  `null` (never a fabricated 0%) for a cut with no DECIDED outcome — a zero-outcome sample
 *  has no rate, and a rendered "0%" reads as "every play lost." Matches calibration.ts's
 *  null-on-empty rule.
 *
 *  `n` is the scoreable row count (what the avg_return is computed over); `decided` is the
 *  win-rate denominator and the low_n key. They are shipped side by side so `n` can never
 *  again be quoted next to a rate it did not produce (the live Largo string read
 *  "0% win rate · 22 graded pick(s)" when the 0% was 0-for-2). */
export type NighthawkRecordCut = {
  n: number;
  decided: number;
  opens: number;
  win_rate: number | null;
  avg_return_pct: number;
  low_n: boolean;
};

export type NighthawkMetrics = {
  window_days: number;
  /** ALL resolved rows in the window, both methodology segments — a raw count, never a
   *  ratio input. Every ratio below is computed from segments.current.scoreable only. */
  total_resolved: number;
  pending_count: number;
  /** PR-N2: headline = CURRENT-methodology scoreable rows ONLY. Legacy-graded rows are
   *  quarantined in segments.legacy and can never move this number.
   *  null (never a fabricated 0) when no play in the window reached a decided outcome —
   *  see NighthawkRecordSegment.decided for why 'open' rows are not in the denominator. */
  win_rate: number | null;
  /** Win-rate denominator: wins + losses over the current-methodology scoreable set.
   *  Every surface that prints the rate must print THIS as its n, not `scoreable`. */
  decided_count: number;
  /** Scoreable rows graded 'open' — the one-session horizon expired untouched. Surfaced so
   *  the gap between `decided_count` and `scoreable` is explained rather than inferred. */
  opens_count: number;
  /** decided_count < LOW_N_THRESHOLD — the headline rate must not be rendered as a record. */
  low_n: boolean;
  /** Close vs entry mid — positive P&L regardless of target/stop tags. */
  profitable_rate: number;
  loss_rate: number;
  open_rate: number;
  ambiguous_rate: number;
  avg_return_pct: number;
  /**
   * PRIMARY return figure: measured from the FILL EDGE (the price a member could actually
   * transact at) rather than the band midpoint. `avg_return_pct` above is the same series
   * on the MID basis, retained in parallel for ONE window so the historical record and
   * every prior audit stay comparable — it is not a second opinion, it is the old basis.
   * Measured gap over the published Legacy window: ~+1.12pp per play in the mid figure's
   * favour. See realizedReturnPctEdge.
   */
  avg_return_pct_edge: number;
  /** profitable_rate on the fill-edge basis. Same parallel-series rule as above. */
  profitable_rate_edge: number;
  avg_winner_return_pct: number;
  avg_loser_return_pct: number;
  /**
   * Number of resolved plays excluded from win/loss counts because a stop level
   * is defined but intraday high/low data was unavailable (OTC/thin names).
   * Effective sample size for win_rate = total_resolved - stop_data_unavailable_count.
   */
  stop_data_unavailable_count: number;
  /** Plays whose session never traded back into the entry band (gap-away) — no fill existed. */
  unfilled_count: number;
  /** PR-N4: plays PULLED pre-open by an INVALIDATED morning verdict (one-way latch).
   *  Their grades are counterfactual-only — excluded from every ratio/bucket above,
   *  surfaced here so the record can say "N pulled" instead of silently shrinking. */
  pulled_count: number;
  /** PR-N2: the methodology tag the headline is computed under (= segments.current.methodology). */
  methodology: string;
  /** PR-N2: per-rule-set record slices, reported separately — the anti-blend contract. */
  segments: { current: NighthawkRecordSegment; legacy: NighthawkRecordSegment };
  /** PR-N10: failure-mode counts from the pinned per-play debriefs (current-methodology
   *  rows only, mirroring the headline's anti-blend rule; low_n-flagged). */
  debrief: NighthawkDebriefRecordSummary;
  by_conviction: Array<{ conviction: string } & NighthawkRecordCut>;
  by_direction: Array<{ direction: "LONG" | "SHORT" } & NighthawkRecordCut>;
  by_sector: Array<{ sector: string } & NighthawkRecordCut>;
  by_score_bucket: Array<{
    bucket: string;
    n: number;
    decided: number;
    opens: number;
    win_rate: number | null;
    low_n: boolean;
  }>;
  by_edition: Array<{ edition_for: string } & NighthawkRecordCut>;
  /** Task #145: synthesis funnel — candidates considered vs. published vs. rejected (by stage),
   *  over the same window_days. Independent of total_resolved/pending_count above: those are
   *  POST-publish outcome grading, this is the PRE-publish publish/reject decision itself. */
  funnel: NighthawkFunnelStats;
};

const SCORE_BUCKETS = ["40-54", "55-69", "70-84", "85-100"] as const;
const CONVICTION_ORDER = ["A+", "A", "B", "C"];

export function entryMid(row: NighthawkPlayOutcomeRow): number | null {
  const mid = entryRangeMid(row.entry_range_low, row.entry_range_high);
  if (mid != null) return mid;
  if (row.entry_range_low != null && row.entry_range_high != null) return null; // corrupt range, no fallback
  return row.next_day_open;
}

export function realizedReturnPct(row: NighthawkPlayOutcomeRow): number | null {
  const entry = entryMid(row);
  const close = row.next_day_close;
  if (entry == null || close == null || entry === 0) return null;
  const raw =
    row.direction === "LONG" ? (close - entry) / entry : (entry - close) / entry;
  return raw * 100;
}

/**
 * The entry price a member could actually have transacted at: the band's FILL EDGE —
 * LONG = band top, SHORT = band bottom, the WORST price in the band. Same convention as
 * `fillEdgeOf` (debrief.ts:201-203) and the publish gate's `fill_edge` (publish-gates.ts).
 *
 * Falls back exactly like `entryMid`: a corrupt band (both bounds present but
 * `entryRangeMid` rejects them) yields null with no guess; a single-bound band is its own
 * edge; no band at all falls back to the session open.
 */
export function entryFillEdge(row: NighthawkPlayOutcomeRow): number | null {
  const low = row.entry_range_low;
  const high = row.entry_range_high;
  if (low != null && high != null) {
    if (entryRangeMid(low, high) == null) return null; // corrupt range, no fallback
    return row.direction === "SHORT" ? low : high;
  }
  const single = low ?? high;
  if (single != null) return single;
  return row.next_day_open;
}

/**
 * Realized return measured from the FILL EDGE rather than the band midpoint.
 *
 * WHY THIS EXISTS (2026-08-06). `realizedReturnPct` above measures from the band MID, but
 * a member fills at the EDGE — and the gap is the band half-width, which is ATR-scaled
 * (0.4 × ATR, play-levels.ts `entryHalfWidth`). Measured over the published Legacy window,
 * that is a systematic **+1.12pp per play** in the reported figure, which is most of the
 * "+0.61% avg return, 68.2% profitable" consolation number sitting beside a 0% win rate.
 *
 * The mid series is deliberately KEPT alongside this one rather than replaced: it is the
 * series every historical audit and the live record were computed on, and silently
 * rewriting it would destroy comparability across the exact window in which the geometry
 * question is being settled. Edge is reported as primary; mid stays for one window.
 */
export function realizedReturnPctEdge(row: NighthawkPlayOutcomeRow): number | null {
  const entry = entryFillEdge(row);
  const close = row.next_day_close;
  if (entry == null || close == null || entry === 0) return null;
  const raw =
    row.direction === "LONG" ? (close - entry) / entry : (entry - close) / entry;
  return raw * 100;
}

function avgOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function avgReturn(rows: NighthawkPlayOutcomeRow[]): number {
  return avgOf(rows.map(realizedReturnPct).filter((v): v is number => v != null));
}

function avgReturnEdge(rows: NighthawkPlayOutcomeRow[]): number {
  return avgOf(rows.map(realizedReturnPctEdge).filter((v): v is number => v != null));
}

// Stop-hit plays should always produce a non-positive realized return. A positive
// average here signals bad outcome grading (next_day_close ended up above entry
// mid on a "stop" row) — surface the magnitude as a loss rather than a positive
// number that reads as a gain to whoever consumes this (member route, admin
// dashboard). Mirrors the same clamp on track-record-page.ts's avgLoserPct.
export function avgLoserReturn(losers: NighthawkPlayOutcomeRow[]): number {
  return Math.min(0, avgReturn(losers));
}

// The DECIDED population: plays whose published levels actually resolved the trade —
// 'target' (win) or 'stop' (loss). Everything else in a scoreable set is undecided:
// 'open' means the one-session grading horizon expired with neither level touched, and
// 'ambiguous' means both traded with the order unrecoverable from close-only data.
// Exported so every surface derives the win-rate denominator from ONE definition.
export function decidedRows(rows: NighthawkPlayOutcomeRow[]): NighthawkPlayOutcomeRow[] {
  return rows.filter((r) => r.outcome === "target" || r.outcome === "stop");
}

// null (not a fabricated 0%) when nothing is decided: a sample with no win and no loss has
// no win rate, and a rendered "0%" reads as "every play lost."
//
// WHY the denominator is `decided` and not `rows.length`: an 'open' play never touched its
// target OR its stop, so it is not evidence the play failed — it is evidence the play was
// never resolved inside the grading horizon. Counting it as a non-win makes it arithmetically
// indistinguishable from a stop-out and pins the rate near 0 forever (live 2026-08-06:
// 0 targets / 2 stops / 20 opens served a hard "0% win rate", while 68.2% of those exact
// plays closed green). Consistent with calibration.ts's null-on-empty rule. Consumers
// coalesce/badge with low_n.
export function winRate(rows: NighthawkPlayOutcomeRow[]): number | null {
  const decided = decidedRows(rows);
  if (decided.length === 0) return null;
  return decided.filter((r) => r.outcome === "target").length / decided.length;
}

export function profitableRate(rows: NighthawkPlayOutcomeRow[]): number | null {
  if (rows.length === 0) return null;
  const withReturn = rows.filter((r) => realizedReturnPct(r) != null);
  if (withReturn.length === 0) return null; // no priced rows → no rate, not a 0%
  return withReturn.filter((r) => (realizedReturnPct(r) ?? 0) > 0).length / withReturn.length;
}

/** profitableRate on the FILL-EDGE basis — see realizedReturnPctEdge. */
export function profitableRateEdge(rows: NighthawkPlayOutcomeRow[]): number | null {
  if (rows.length === 0) return null;
  const withReturn = rows.filter((r) => realizedReturnPctEdge(r) != null);
  if (withReturn.length === 0) return null;
  return withReturn.filter((r) => (realizedReturnPctEdge(r) ?? 0) > 0).length / withReturn.length;
}

function scoreBucket(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 40 && score <= 54) return "40-54";
  if (score >= 55 && score <= 69) return "55-69";
  if (score >= 70 && score <= 84) return "70-84";
  if (score >= 85 && score <= 100) return "85-100";
  return null;
}

export function groupWithReturn(rows: NighthawkPlayOutcomeRow[]): NighthawkRecordCut {
  const decided = decidedRows(rows).length;
  return {
    n: rows.length,
    decided,
    opens: rows.filter((r) => r.outcome === "open").length,
    win_rate: winRate(rows),
    avg_return_pct: avgReturn(rows),
    // Shared platform threshold (zerodte/record.ts): a cut below it must be badged by
    // every consumer — its ratio is noise, not a record. Measured against DECIDED
    // outcomes, not row count: a 12-row conviction bucket holding 12 no-touch plays has
    // produced zero evidence and must badge as thin (live A-tier: n=12, decided=0).
    low_n: decided < LOW_N_THRESHOLD,
  };
}

/** PR-N2: the segmentation itself, exported so tests can pin the anti-blend rule.
 *  `current` admits ONLY rows explicitly stamped with the current methodology tag;
 *  everything else resolved — legacy tags, unknown tags, NULL — quarantines to
 *  `legacy`. Unprovable provenance degrades away from the headline, never toward it. */
export function partitionByMethodology(rows: NighthawkPlayOutcomeRow[]): {
  current: NighthawkPlayOutcomeRow[];
  legacy: NighthawkPlayOutcomeRow[];
} {
  const current: NighthawkPlayOutcomeRow[] = [];
  const legacy: NighthawkPlayOutcomeRow[] = [];
  for (const row of rows) {
    (isCurrentGradeMethodology(row.grade_methodology) ? current : legacy).push(row);
  }
  return { current, legacy };
}

/** One rule set's record slice. Scoreability inside a segment follows the same
 *  exclusion discipline as the headline always has (unfilled / pulled /
 *  stop-data-unavailable never enter the denominator but are always surfaced). */
export function buildRecordSegment(
  methodology: string,
  rows: NighthawkPlayOutcomeRow[]
): NighthawkRecordSegment {
  const unfilled = rows.filter((r) => r.outcome === "unfilled");
  const pulled = rows.filter((r) => r.pulled === true);
  const stopDataUnavailable = rows.filter(isStopDataUnavailable);
  const scoreable = rows.filter(
    (r) => !isStopDataUnavailable(r) && r.outcome !== "unfilled" && r.pulled !== true
  );
  const wins = scoreable.filter((r) => r.outcome === "target").length;
  const losses = scoreable.filter((r) => r.outcome === "stop").length;
  const opens = scoreable.filter((r) => r.outcome === "open").length;
  const ambiguous = scoreable.filter((r) => r.outcome === "ambiguous").length;
  // The rate's denominator is the DECIDED subset, not the whole scoreable set: `scoreable`
  // is the exclusion-accounting/return-averaging population and still carries opens +
  // ambiguous. Both numbers ship so no consumer has to guess which one a rate came from.
  const decided = wins + losses;
  return {
    methodology,
    label: gradeMethodologyLabel(methodology),
    resolved: rows.length,
    scoreable: scoreable.length,
    wins,
    losses,
    opens,
    ambiguous,
    unfilled: unfilled.length,
    pulled: pulled.length,
    stop_data_unavailable: stopDataUnavailable.length,
    decided,
    win_rate: decided > 0 ? wins / decided : null,
    avg_return_pct: scoreable.length > 0 ? avgReturn(scoreable) : null,
    low_n: decided < LOW_N_THRESHOLD,
  };
}

function emptyMetrics(windowDays: number): NighthawkMetrics {
  return {
    window_days: windowDays,
    total_resolved: 0,
    pending_count: 0,
    // null, never 0: an empty window has no win rate. A rendered "0%" is a claim that every
    // play lost, which is a false statement about trading performance.
    win_rate: null,
    decided_count: 0,
    opens_count: 0,
    low_n: true,
    profitable_rate: 0,
    loss_rate: 0,
    open_rate: 0,
    ambiguous_rate: 0,
    avg_return_pct: 0,
    avg_return_pct_edge: 0,
    profitable_rate_edge: 0,
    avg_winner_return_pct: 0,
    avg_loser_return_pct: 0,
    // Empty cuts carry win_rate: null (not 0%) — same honesty rule as groupWithReturn.
    by_conviction: CONVICTION_ORDER.map((conviction) => ({
      conviction,
      n: 0,
      decided: 0,
      opens: 0,
      win_rate: null,
      avg_return_pct: 0,
      low_n: true,
    })),
    by_direction: (["LONG", "SHORT"] as const).map((direction) => ({
      direction,
      n: 0,
      decided: 0,
      opens: 0,
      win_rate: null,
      avg_return_pct: 0,
      low_n: true,
    })),
    by_sector: [],
    by_score_bucket: SCORE_BUCKETS.map((bucket) => ({
      bucket,
      n: 0,
      decided: 0,
      opens: 0,
      win_rate: null,
      low_n: true,
    })),
    by_edition: [],
    stop_data_unavailable_count: 0,
    unfilled_count: 0,
    pulled_count: 0,
    methodology: GRADE_METHODOLOGY_CURRENT,
    segments: {
      current: buildRecordSegment(GRADE_METHODOLOGY_CURRENT, []),
      legacy: buildRecordSegment(GRADE_METHODOLOGY_LEGACY, []),
    },
    debrief: summarizeDebriefPins([]),
    funnel: buildNighthawkFunnel(windowDays, 0, []),
  };
}

/**
 * Returns true for plays where a stop is defined but intraday data is missing.
 * These plays cannot have stop outcomes reliably determined and must be excluded
 * from win/loss tallies to avoid silently inflating the win rate.
 */
function isStopDataUnavailable(r: NighthawkPlayOutcomeRow): boolean {
  return r.stop != null && r.session_high == null && r.session_low == null;
}

export async function getNighthawkMetrics(windowDays = 30): Promise<NighthawkMetrics> {
  // Independent reads (outcome grading vs. the pre-publish funnel) — run in parallel so the
  // funnel query never adds to this route's latency on top of the existing outcome query.
  const [{ rows, pending_count }, funnelRaw] = await Promise.all([
    fetchNighthawkOutcomeAnalytics(windowDays),
    fetchNighthawkFunnelStats(windowDays),
  ]);
  const funnel = buildNighthawkFunnel(windowDays, funnelRaw.published_count, funnelRaw.rejected_by_reason);

  if (rows.length === 0) {
    return { ...emptyMetrics(windowDays), pending_count, funnel };
  }

  const total = rows.length;
  // PR-N2: segment by grading methodology FIRST — everything headline-facing below is
  // computed over the CURRENT-methodology segment only. Legacy-graded rows (pre-
  // fillability "level touch" grades, incl. the phantom gap-away wins) live in
  // segments.legacy, reported side by side, never aggregated: on the measured history
  // the blend read 42.9% WR while the same plays under current rules read 11.1%.
  const { current: currentRows, legacy: legacyRows } = partitionByMethodology(rows);
  const segments = {
    current: buildRecordSegment(GRADE_METHODOLOGY_CURRENT, currentRows),
    legacy: buildRecordSegment(GRADE_METHODOLOGY_LEGACY, legacyRows),
  };
  // Exclusion discipline, unchanged (audit MEDIUM / PR-N4) but now applied within the
  // current segment: stop-data-unavailable (unevaluable stops), 'unfilled' (gap-away —
  // no fill existed to win or lose), and pulled (INVALIDATED pre-open, one-way latch;
  // grade is counterfactual-only) never enter a ratio denominator and are surfaced as
  // counts. Same rule as track-record-page.ts's isNighthawkOutcomeScoreable — keep the
  // two in lockstep.
  const scoreable = currentRows.filter(
    (r) => !isStopDataUnavailable(r) && r.outcome !== "unfilled" && r.pulled !== true
  );

  const winners = scoreable.filter((r) => r.outcome === "target");
  const losers = scoreable.filter((r) => r.outcome === "stop");
  const opens = scoreable.filter((r) => r.outcome === "open");
  const ambiguous = scoreable.filter((r) => r.outcome === "ambiguous");

  const by_conviction = CONVICTION_ORDER.map((conviction) => ({
    conviction,
    ...groupWithReturn(scoreable.filter((r) => r.conviction.toUpperCase() === conviction)),
  }));

  const by_direction = (["LONG", "SHORT"] as const).map((direction) => ({
    direction,
    ...groupWithReturn(scoreable.filter((r) => r.direction === direction)),
  }));

  const sectorMap = new Map<string, NighthawkPlayOutcomeRow[]>();
  for (const row of scoreable) {
    const sector = row.sector?.trim() || "Unknown";
    const bucket = sectorMap.get(sector) ?? [];
    bucket.push(row);
    sectorMap.set(sector, bucket);
  }
  const by_sector = Array.from(sectorMap.entries())
    .map(([sector, group]) => ({ sector, ...groupWithReturn(group) }))
    .filter((g) => g.n > 0)
    // g.n > 0 guarantees a non-null win_rate here; coalesce only to satisfy the widened type.
    .sort((a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0) || b.n - a.n);

  const by_score_bucket = SCORE_BUCKETS.map((bucket) => {
    const group = scoreable.filter((r) => scoreBucket(r.score) === bucket);
    const decided = decidedRows(group).length;
    return {
      bucket,
      n: group.length,
      decided,
      opens: group.filter((r) => r.outcome === "open").length,
      win_rate: winRate(group),
      // Same rule as groupWithReturn: thin evidence is measured in DECIDED outcomes.
      low_n: decided < LOW_N_THRESHOLD,
    };
  });

  const editionMap = new Map<string, NighthawkPlayOutcomeRow[]>();
  for (const row of scoreable) {
    const bucket = editionMap.get(row.edition_for) ?? [];
    bucket.push(row);
    editionMap.set(row.edition_for, bucket);
  }
  const by_edition = Array.from(editionMap.entries())
    .map(([edition_for, group]) => ({ edition_for, ...groupWithReturn(group) }))
    .sort((a, b) => a.edition_for.localeCompare(b.edition_for));

  const scoreableTotal = scoreable.length;
  // Kept identical to buildRecordSegment's `decided` — this headline block duplicates the
  // segment math (which is exactly how the open-in-denominator bug survived a segment-level
  // review), so both are pinned by the same test fixture.
  const decidedTotal = winners.length + losers.length;
  return {
    window_days: windowDays,
    total_resolved: total,
    pending_count,
    // Exclusion counts mirror the headline's segment (current) so the numbers displayed
    // next to the win rate explain ITS denominator; the legacy segment carries its own.
    stop_data_unavailable_count: segments.current.stop_data_unavailable,
    unfilled_count: segments.current.unfilled,
    pulled_count: segments.current.pulled,
    methodology: GRADE_METHODOLOGY_CURRENT,
    segments,
    // PR-N10: all resolved rows in — summarizeDebriefPins applies the same current-
    // methodology filter internally AND reports the legacy quarantine count honestly.
    debrief: summarizeDebriefPins(rows),
    // WIN RATE = wins / DECIDED (wins + losses), NOT wins / scoreable. `scoreable` still
    // carries every 'open' row — a play whose one-session horizon expired without touching
    // target or stop. Those plays were never decided, so counting them as non-wins made a
    // no-touch row arithmetically identical to a stop-out and pinned the headline at 0%
    // until literally every play terminated (live 2026-08-06: 0/22 with 20 opens → a hard
    // "0% win rate" beside a 68.2% profitable rate on the SAME 22 plays). Null — never a
    // fabricated 0 — when the window produced no decided outcome at all; the headline now
    // carries low_n so surfaces can render "—" instead of inventing a rate.
    win_rate: decidedTotal > 0 ? winners.length / decidedTotal : null,
    decided_count: decidedTotal,
    opens_count: opens.length,
    low_n: decidedTotal < LOW_N_THRESHOLD,
    // profitable_rate / loss_rate / open_rate / ambiguous_rate stay on `scoreable`: they are
    // composition shares of the graded population (what fraction closed green, stopped, never
    // triggered), not the target-hit rate. Re-basing them here would be denominator-shopping
    // in the opposite direction. Their LABELS carry the distinction on the render side.
    profitable_rate: profitableRate(scoreable) ?? 0,
    loss_rate: scoreableTotal > 0 ? losers.length / scoreableTotal : 0,
    open_rate: scoreableTotal > 0 ? opens.length / scoreableTotal : 0,
    ambiguous_rate: scoreableTotal > 0 ? ambiguous.length / scoreableTotal : 0,
    avg_return_pct: avgReturn(scoreable),
    // The honest basis, over the SAME scoreable denominator — only the entry price differs.
    avg_return_pct_edge: avgReturnEdge(scoreable),
    profitable_rate_edge: profitableRateEdge(scoreable) ?? 0,
    avg_winner_return_pct: avgReturn(winners),
    avg_loser_return_pct: avgLoserReturn(losers),
    by_conviction,
    by_direction,
    by_sector,
    by_score_bucket,
    by_edition,
    funnel,
  };
}
