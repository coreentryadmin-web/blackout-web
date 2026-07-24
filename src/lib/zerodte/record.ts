// 0DTE Command multi-day track record (proposal P-3, docs/audit/NIGHTHAWK-VS-SLAYER-0DTE.md §5;
// build item 3 of the decision doc). Until this module, the platform's most ACTIVE play
// surface was the only one whose record members could not see: zerodte_setup_log rows are
// graded per-play (plan_outcome/plan_pnl_pct + direction_hit), but no API aggregated them —
// the board serves today only, and /api/track-record covered Slayer + Night Hawk editions.
//
// Pure functions over already-fetched ledger rows (the route does the fetching), so the
// aggregation math is unit-tested against fixture ledgers — including the real 7/13 session
// (1W/7L) whose shape motivated the whole audit. Methodology discipline (hard rule from the
// decision doc §3): these are PLAN-OUTCOME grades on option premium (−50%/+100%/15:30 plan) —
// NEVER blend them with SPX Slayer's pnl-points or Night Hawk's stock-move percentages.

import type { ZeroDteSetupLogRow } from "@/lib/db";
import { etMinutesOf } from "./plan";
import { tierFromEntryContext, type ZeroDteTier } from "./tiers";

/** Methodology label served with every payload built here — the honest-record rule.
 *  The headline record is the AS-MANAGED grade: the exit the member is actually
 *  live-guided to take (the exit engine's realized ratchet / thesis-break / flat-timeout
 *  / plan stop-or-target exit, stamped at entry_context.exit), falling back to the fixed
 *  mechanical plan grade only when no engine exit fired (the play rode the plan's own
 *  stop/target/time-stop). The fixed −50/+100/15:30 plan grade is kept alongside as a
 *  labeled comparison (`mechanical`), never as the member-facing number. */
export const ZERODTE_RECORD_METHODOLOGY =
  "0DTE Command results are AS-MANAGED grades: the exit the member was live-guided to " +
  "take (profit-ratchet, thesis-break, flat-timeout, or the printed plan's stop/target), " +
  "on the option's own premium, from the scanner ledger (every committed setup, no " +
  "cherry-picking). A win is positive realized P&L. The fixed -50%/+100%/15:30-ET plan " +
  "grade is reported beside it as a labeled hold-to-stop/target comparison, never blended " +
  "in. These are option-premium returns — not SPX Slayer point results and not Night Hawk " +
  "stock-move returns; the three methodologies are never blended.";

/** Buckets with fewer graded plays than this are flagged low_n so UIs can badge them —
 *  the forensics rule: never let a 2-sample bucket read like a track record. */
export const LOW_N_THRESHOLD = 5;

export type ZeroDteRecordPlay = {
  session_date: string;
  ticker: string;
  direction: "long" | "short";
  /** ISO first-flag instant + its ET rendering (the desk time members saw it). */
  flagged_at: string;
  flagged_et: string;
  /** Peak evidence score for the session (score_max) — the committed score, when the
   *  row carries entry_context, lives in entry_context.score. */
  score: number;
  conviction: string | null;
  /** MECHANICAL plan grade (fixed -50/+100/15:30) — the labeled comparison, not the
   *  headline. Kept per-play so the desk can show "managed vs held" side by side. */
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  /** AS-MANAGED grade — how the position ACTUALLY closed (the exit the member was
   *  guided to). `managed_source`: "engine" = from a stamped entry_context.exit (the
   *  live ratchet/thesis/flat/plan exit), "plan" = no engine exit fired so it rode to
   *  the mechanical outcome, null = ungraded. This is the member-facing per-play result. */
  managed_outcome: string | null;
  managed_pnl_pct: number | null;
  managed_source: "engine" | "plan" | null;
  /** Underlying direction grade (close vs flag) — the separate honesty ledger. */
  direction_hit: boolean | null;
  move_pct: number | null;
  /** Context-at-entry blob once present (C-2) — null on rows older than the column. */
  entry_context: Record<string, unknown> | null;
  /** Merit tier (PR-F), derived RETROACTIVELY from the pinned entry_context via
   *  tierFromEntryContext — never re-derived from live data, so the tier a member
   *  sees on a past play is the tier its commit-time evidence earns. Null on
   *  pre-context rows (zero pinned evidence is "untiered", not "C"). Note: "A+"
   *  cannot appear here by type — it is a DISPLAY promotion earned from the A
   *  bucket's measured record (calibration.ts analyzeTierRecord + tiers.ts
   *  displayTierFor), never stamped on a play. */
  tier: ZeroDteTier | null;
};

export type ZeroDteRecordBucket = {
  label: string;
  n: number;
  wins: number;
  losses: number;
  /** pnl exactly 0 — neither win nor loss (SPX 3-way parity). Included in n and in the
   *  win-rate denominator, excluded from wins and losses. */
  breakeven: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
  /** n < LOW_N_THRESHOLD — UIs must badge these, aggregators must not lean on them. */
  low_n: boolean;
};

/** The headline win/loss/breakeven roll-up for ONE grading track (as-managed OR
 *  mechanical). Same 3-way partition as the SPX ledger: wins + losses + breakeven == graded. */
export type ZeroDteRecordRollup = {
  graded: number;
  wins: number;
  losses: number;
  breakeven: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
  by_outcome: ZeroDteRecordBucket[];
};

export type ZeroDteRecord = {
  methodology: string;
  window: { since: string; through: string; days: number; sessions: number };
  /** Every ledger row in the window (graded or not) — the per-play record. */
  plays: ZeroDteRecordPlay[];
  total_flagged: number;
  // ── Headline = AS-MANAGED (the exit the member actually trades). ──────────────────
  /** Rows with a real as-managed grade (a stamped engine exit, or a mechanical grade
   *  it fell back to). */
  graded: number;
  ungraded: number;
  wins: number;
  losses: number;
  /** pnl exactly 0 — SPX 3-way parity, excluded from wins AND losses. */
  breakeven: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
  by_outcome: ZeroDteRecordBucket[];
  by_time_of_day: ZeroDteRecordBucket[];
  by_direction: ZeroDteRecordBucket[];
  by_score_band: ZeroDteRecordBucket[];
  /** The fixed -50/+100/15:30 plan grade over the SAME rows — labeled comparison only,
   *  never the member-facing headline (see ZERODTE_RECORD_METHODOLOGY). Identical to the
   *  headline whenever no engine exit fired on any row (the clean hold-to-plan path). */
  mechanical: ZeroDteRecordRollup;
  available: boolean;
};

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Same graded-row predicate the calibration harness uses (bie/calibration.ts):
 *  'ungradeable' means the plan could not be measured — it is neither W nor L.
 *
 *  A grade requires BOTH a real outcome AND a finite plan_pnl_pct: the win predicate
 *  (isZeroDteWin) keys on plan_pnl_pct while this one keys on plan_outcome, so a PARTIAL
 *  write — plan_outcome stamped but plan_pnl_pct still NULL (two column writes, a crash
 *  between them, a NUMERIC that failed to coerce) — used to count as graded-but-not-a-win,
 *  i.e. silently booked a LOSS. Requiring a finite pnl here means the two predicates can
 *  never disagree: a row missing its pnl is ungraded (retried), not a phantom loss. */
export function isGradedZeroDteRow(
  row: Pick<ZeroDteSetupLogRow, "plan_outcome" | "plan_pnl_pct">
): boolean {
  return (
    row.plan_outcome != null &&
    row.plan_outcome !== "ungradeable" &&
    row.plan_pnl_pct != null &&
    Number.isFinite(row.plan_pnl_pct)
  );
}

/** Win = positive plan P&L — identical to the calibration harness's definition AND the feature
 *  store's labelFromPlanOutcome (feature-store.ts), so the member-facing record, the internal
 *  calibration, and the learning store can never disagree on what a win is. In particular a GREEN
 *  time_stop is a win in all three (it was previously a loss in the feature store — a bias fixed
 *  by pointing that label at this same plan_pnl_pct > 0 predicate). */
export function isZeroDteWin(row: Pick<ZeroDteSetupLogRow, "plan_pnl_pct">): boolean {
  return (row.plan_pnl_pct ?? 0) > 0;
}

// ── Grade views: one normalized W/L/BE + outcome-label per row, per track ────────────
// A row is graded twice: MECHANICAL (the fixed -50/+100/15:30 plan grade, from
// plan_outcome/plan_pnl_pct) and AS-MANAGED (the exit the member was actually guided to
// — the exit engine's realized exit stamped at entry_context.exit, falling back to the
// mechanical grade when no engine exit fired). Both reduce to this shape so the headline
// (as-managed) and the labeled comparison (mechanical) share one bucketing path.

type GradeView = {
  graded: boolean;
  /** Outcome bucket label (doubled/stopped/time_stop/ratchet/thesis_break/flat_scratch/…). */
  outcome: string | null;
  pnl_pct: number | null;
  win: boolean;
  /** pnl exactly 0 — neither win nor loss. */
  breakeven: boolean;
  /** as-managed only: where the grade came from. */
  source: "engine" | "plan" | null;
};

/** The exit engine's realized-exit record, stamped first-write-wins at entry_context.exit
 *  (exit-engine.ts buildExitContext → db.stampZeroDteExitContext). Read defensively —
 *  every field optional, malformed blobs degrade to "no engine exit". */
export function readManagedExit(
  entryContext: Record<string, unknown> | null | undefined
): { reason: string | null; pnl_pct: number | null } | null {
  const exit = entryContext?.exit;
  if (!exit || typeof exit !== "object") return null;
  const e = exit as Record<string, unknown>;
  const pnl = typeof e.pnl_pct === "number" && Number.isFinite(e.pnl_pct) ? e.pnl_pct : null;
  const reason = typeof e.reason === "string" ? e.reason : null;
  return { reason, pnl_pct: pnl };
}

/** Map an engine EXIT reason (exit-engine.ts) to a record outcome bucket. Only EXIT
 *  decisions stamp entry_context.exit, so the reason is always one of the exit reasons. */
function managedOutcomeLabel(reason: string | null, pnl: number): string {
  // Missing/unknown/future reason: bucket by sign rather than mislabel it as a known outcome.
  const bySign = pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven";
  if (reason == null) return bySign;
  if (reason === "plan_stop") return "stopped";
  if (reason === "plan_target_final") return "doubled";
  if (reason.startsWith("thesis_break")) return "thesis_break";
  if (reason === "flat_theta_bleed") return "flat_scratch";
  if (/ratchet|runner/.test(reason)) return "ratchet";
  return bySign;
}

/** MECHANICAL grade view — the fixed -50/+100/15:30 plan grade. */
function mechanicalGradeView(row: ZeroDteSetupLogRow): GradeView {
  const graded = isGradedZeroDteRow(row);
  const pnl = graded ? round2(row.plan_pnl_pct as number) : null;
  return {
    graded,
    outcome: graded ? row.plan_outcome : null,
    pnl_pct: pnl,
    win: pnl != null && pnl > 0,
    breakeven: pnl === 0,
    source: null,
  };
}

/** AS-MANAGED grade view — the exit the member was live-guided to take. Engine exit
 *  (entry_context.exit) when one was stamped; otherwise the play rode to the plan's own
 *  stop/target/time-stop, so it falls back to the mechanical grade. This is the headline. */
function managedGradeView(row: ZeroDteSetupLogRow): GradeView {
  const exit = readManagedExit(row.entry_context);
  if (exit && exit.pnl_pct != null) {
    const pnl = round2(exit.pnl_pct);
    return {
      graded: true,
      outcome: managedOutcomeLabel(exit.reason, pnl),
      pnl_pct: pnl,
      win: pnl > 0,
      breakeven: pnl === 0,
      source: "engine",
    };
  }
  const mech = mechanicalGradeView(row);
  return { ...mech, source: mech.graded ? "plan" : null };
}

/** The score every score-band gate acted on: commit-time score from entry_context when
 *  the row carries one (C-2 rows), else score_max (pre-context rows — the ratcheted peak,
 *  the same field the calibration harness bands by). */
export function scoreForBanding(
  row: Pick<ZeroDteSetupLogRow, "score_max" | "entry_context">
): number {
  const ctxScore = row.entry_context?.score;
  return typeof ctxScore === "number" && Number.isFinite(ctxScore) ? ctxScore : row.score_max;
}

/** Time-of-day bucket for a first-flag instant. The three RTH windows come from the
 *  decision-doc factor cuts (open-window weakness F-4 / prime / midday / late); "open"
 *  covers 9:30-9:50 and "other" catches anything outside RTH commit hours so no play
 *  is ever silently dropped from the cut. */
export function todBucket(firstFlaggedAt: string): string {
  const m = etMinutesOf(Date.parse(firstFlaggedAt));
  if (m < 9 * 60 + 30) return "other";
  if (m < 9 * 60 + 50) return "open 9:30-9:50";
  if (m < 11 * 60) return "prime 9:50-11:00";
  if (m < 14 * 60) return "midday 11:00-14:00";
  if (m <= 15 * 60 + 30) return "late 14:00-15:30";
  return "other";
}

export function scoreBand(score: number): string {
  // Band edges match the engine's own calibration finding (F-2): 55-64 is the
  // below-breakeven band; 65 is the proposed commit floor (gate G-3).
  if (score >= 65) return "score 65+";
  if (score >= 55) return "score 55-64";
  return "score <55";
}

/** Deterministic bucket ordering so payloads (and their tests) never depend on
 *  Map insertion order of whatever the ledger happened to contain. */
const BUCKET_ORDER: Record<string, number> = {
  // by_outcome (mechanical: doubled/stopped/time_stop; as-managed adds the engine exits)
  doubled: 0,
  ratchet: 1,
  stopped: 2,
  time_stop: 3,
  thesis_break: 4,
  flat_scratch: 5,
  // by_time_of_day
  "open 9:30-9:50": 0,
  "prime 9:50-11:00": 1,
  "midday 11:00-14:00": 2,
  "late 14:00-15:30": 3,
  other: 4,
  // by_direction
  long: 0,
  short: 1,
  // by_score_band
  "score 65+": 0,
  "score 55-64": 1,
  "score <55": 2,
};

/** A graded row paired with its grade view (as-managed or mechanical). bucketize and the
 *  headline roll-up both run over these so a bucket's W/L/BE always matches the track it
 *  was built for — the win/loss/pnl come from the VIEW, the cut key from the ROW. */
type GradedRow = { row: ZeroDteSetupLogRow; view: GradeView };

function bucketize(
  graded: GradedRow[],
  label: (g: GradedRow) => string
): ZeroDteRecordBucket[] {
  const groups = new Map<string, GradedRow[]>();
  for (const g of graded) {
    const key = label(g);
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  return Array.from(groups.entries())
    .map(([lbl, group]) => ({ label: lbl, ...rollupCounts(group) }))
    .sort(
      (a, b) =>
        (BUCKET_ORDER[a.label] ?? 99) - (BUCKET_ORDER[b.label] ?? 99) ||
        a.label.localeCompare(b.label)
    );
}

/** W/L/BE + rate + avg-pnl over a group of graded rows — the SPX 3-way partition (wins +
 *  losses + breakeven == n; win-rate is wins/n with breakeven in the denominator). */
function rollupCounts(group: GradedRow[]): Omit<ZeroDteRecordBucket, "label"> {
  const wins = group.filter((g) => g.view.win).length;
  const breakeven = group.filter((g) => g.view.breakeven).length;
  const pnls = group.map((g) => g.view.pnl_pct).filter((p): p is number => p != null);
  return {
    n: group.length,
    wins,
    losses: group.length - wins - breakeven,
    breakeven,
    win_rate_pct: group.length > 0 ? round1((wins / group.length) * 100) : null,
    avg_pnl_pct: pnls.length ? round2(pnls.reduce((a, b) => a + b, 0) / pnls.length) : null,
    low_n: group.length < LOW_N_THRESHOLD,
  };
}

/** Headline roll-up (graded-count + W/L/BE + rate + avg + by_outcome) for ONE track. */
function rollup(graded: GradedRow[]): ZeroDteRecordRollup {
  const counts = rollupCounts(graded);
  return {
    graded: counts.n,
    wins: counts.wins,
    losses: counts.losses,
    breakeven: counts.breakeven,
    win_rate_pct: counts.win_rate_pct,
    avg_pnl_pct: counts.avg_pnl_pct,
    by_outcome: bucketize(graded, (g) => g.view.outcome ?? "ungraded"),
  };
}

function toPlay(r: ZeroDteSetupLogRow): ZeroDteRecordPlay {
  const flaggedMs = Date.parse(r.first_flagged_at);
  const m = Number.isFinite(flaggedMs) ? etMinutesOf(flaggedMs) : null;
  const flaggedEt =
    m != null
      ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} ET`
      : "";
  const managed = managedGradeView(r);
  return {
    session_date: r.session_date,
    ticker: r.ticker,
    direction: r.direction,
    flagged_at: r.first_flagged_at,
    flagged_et: flaggedEt,
    score: r.score_max,
    conviction: r.conviction,
    plan_outcome: r.plan_outcome,
    plan_pnl_pct: r.plan_pnl_pct != null ? round2(r.plan_pnl_pct) : null,
    managed_outcome: managed.outcome,
    managed_pnl_pct: managed.pnl_pct,
    managed_source: managed.source,
    direction_hit: r.direction_hit,
    move_pct: r.move_pct != null ? round2(r.move_pct) : null,
    entry_context: r.entry_context,
    tier: tierFromEntryContext(r.entry_context)?.tier ?? null,
  };
}

/**
 * Build the multi-day record from ledger rows (any order). The HEADLINE is the AS-MANAGED
 * grade (the exit the member was live-guided to take); the fixed mechanical plan grade is
 * reported beside it as a labeled comparison (`mechanical`). Aggregates run over GRADED
 * rows only; ungraded rows (today's live session, or backfill-pending index roots) still
 * appear in `plays` with null grades — present but never counted, the same provisional
 * discipline the forensics applied to 7/13's live ledger. When no engine exit fired on any
 * row, as-managed == mechanical (the clean hold-to-plan path — the historical behavior).
 */
export function buildZeroDteRecord(
  rows: ZeroDteSetupLogRow[],
  window: { since: string; through: string; days: number }
): ZeroDteRecord {
  const sorted = [...rows].sort(
    (a, b) => b.session_date.localeCompare(a.session_date) || a.ticker.localeCompare(b.ticker)
  );
  // Two parallel tracks over the SAME rows: as-managed (headline) + mechanical (comparison).
  const managed: GradedRow[] = sorted
    .map((row) => ({ row, view: managedGradeView(row) }))
    .filter((g) => g.view.graded);
  const mechanical: GradedRow[] = sorted
    .map((row) => ({ row, view: mechanicalGradeView(row) }))
    .filter((g) => g.view.graded);
  const headline = rollup(managed);
  const sessions = new Set(sorted.map((r) => r.session_date)).size;

  return {
    methodology: ZERODTE_RECORD_METHODOLOGY,
    window: { ...window, sessions },
    plays: sorted.map(toPlay),
    total_flagged: sorted.length,
    graded: headline.graded,
    ungraded: sorted.length - headline.graded,
    wins: headline.wins,
    losses: headline.losses,
    breakeven: headline.breakeven,
    win_rate_pct: headline.win_rate_pct,
    avg_pnl_pct: headline.avg_pnl_pct,
    by_outcome: headline.by_outcome,
    by_time_of_day: bucketize(managed, (g) => todBucket(g.row.first_flagged_at)),
    by_direction: bucketize(managed, (g) => g.row.direction),
    by_score_band: bucketize(managed, (g) => scoreBand(scoreForBanding(g.row))),
    mechanical: rollup(mechanical),
    available: managed.length > 0,
  };
}
