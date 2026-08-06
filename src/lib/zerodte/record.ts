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
   *  guided to). `managed_source`: "reconstructed" = a WS-11 TRIM-SCALE partial-path
   *  reconstruction (the ⅓/⅓/⅓ scale-out replayed executable-side — the canonical official
   *  number), "engine" = a stamped entry_context.exit (the live ratchet/thesis/flat/plan
   *  single exit), "plan" = no engine exit fired so it rode to the mechanical outcome, null =
   *  ungraded. This is the member-facing per-play result. */
  managed_outcome: string | null;
  managed_pnl_pct: number | null;
  managed_source: "reconstructed" | "engine" | "plan" | null;
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

// ── WS-10: the OFFICIAL plan P&L is the CONSERVATIVE EXECUTABLE lane ─────────────────
// The grader now writes TWO lanes: the mid grade in the `plan_pnl_pct`/`plan_outcome`
// columns (monitoring/comparison) and the conservative-executable grade (entry=ask,
// exit=bid) pinned additively at entry_context.executable (scan.ts / stampZeroDteExecutableGrade).
// The member-facing record AND calibration grade on the EXECUTABLE lane — the return a
// member could actually have exited at — falling back to the mid columns ONLY for legacy
// rows graded before WS-10 (no `executable` key). Reads are defensive: a malformed blob
// degrades to the mid fallback, never a fabricated number.

/** The minimal row shape the official-P&L readers need: the mid columns plus the optional
 *  entry_context that may carry the executable lane. `entry_context` is optional so a bare
 *  `{ plan_pnl_pct }` fixture (and the reused swing rows, which never carry an executable
 *  key) still typecheck and simply fall back to the mid column. */
export type OfficialGradableRow = {
  plan_outcome?: string | null;
  plan_pnl_pct: number | null;
  entry_context?: Record<string, unknown> | null;
};

/** Read the executable-lane grade off entry_context.executable (WS-10). Null = the row was
 *  graded before WS-10 (mid only) or the blob is absent/malformed — the callers then use the
 *  mid columns. Only a FINITE plan_pnl_pct counts as a real executable grade. */
export function readExecutableGrade(
  entryContext: Record<string, unknown> | null | undefined
): { plan_outcome: string | null; plan_pnl_pct: number | null } | null {
  const ex = entryContext?.executable;
  if (!ex || typeof ex !== "object") return null;
  const e = ex as Record<string, unknown>;
  const pnl = typeof e.plan_pnl_pct === "number" && Number.isFinite(e.plan_pnl_pct) ? e.plan_pnl_pct : null;
  if (pnl == null) return null;
  const outcome = typeof e.plan_outcome === "string" ? e.plan_outcome : null;
  return { plan_outcome: outcome, plan_pnl_pct: pnl };
}

/** The OFFICIAL per-row plan P&L: the executable lane when the row carries it, else the mid
 *  column (legacy). This is the number calibration buckets and the record grades on. */
export function officialPlanPnlPct(row: OfficialGradableRow): number | null {
  return readExecutableGrade(row.entry_context)?.plan_pnl_pct ?? row.plan_pnl_pct;
}

/** The OFFICIAL per-row plan outcome label — the executable lane's outcome when present, else
 *  the mid column. Kept in lockstep with officialPlanPnlPct so the label and the pnl agree. */
export function officialPlanOutcome(row: OfficialGradableRow): string | null {
  return readExecutableGrade(row.entry_context)?.plan_outcome ?? row.plan_outcome ?? null;
}

// ── WS-11: the OFFICIAL executable grade of a TRIM-SCALE row IS a reconstructed as-managed path ──
// A trim_scale row's executable grade (entry_context.executable) is written by the grader as the
// RECONSTRUCTED ⅓/⅓/⅓ scale-out (reconstructTrimScaleExecutableFromBars, scan.ts), carrying a
// per-leg `tranches` array. Presence of that array is the signal that the OFFICIAL number is the
// as-managed path itself — so the member-facing as-managed headline reads the SAME number the
// calibration lane grades (officialPlanPnlPct), making grade_vs_asmanaged_delta ≈ 0 by
// construction. Ratchet / legacy rows carry NO tranches, so this returns null and the as-managed
// headline keeps its prior behavior (the live single-exit stamp, else the mechanical fallback).

/** Read a WS-11 reconstructed TRIM-SCALE grade off entry_context.executable — only when it
 *  carries a non-empty `tranches` array AND a finite plan_pnl_pct (a real reconstruction).
 *  Null for ratchet/legacy executable blobs (no tranches) and malformed blobs. */
export function readReconstructedTrimScale(
  entryContext: Record<string, unknown> | null | undefined
): { plan_outcome: string | null; plan_pnl_pct: number } | null {
  const ex = entryContext?.executable;
  if (!ex || typeof ex !== "object") return null;
  const e = ex as Record<string, unknown>;
  if (!Array.isArray(e.tranches) || e.tranches.length === 0) return null;
  const pnl = typeof e.plan_pnl_pct === "number" && Number.isFinite(e.plan_pnl_pct) ? e.plan_pnl_pct : null;
  if (pnl == null) return null;
  const outcome = typeof e.plan_outcome === "string" ? e.plan_outcome : null;
  return { plan_outcome: outcome, plan_pnl_pct: pnl };
}

/** Same graded-row predicate the calibration harness uses (bie/calibration.ts):
 *  'ungradeable' means the plan could not be measured — it is neither W nor L.
 *
 *  A grade requires BOTH a real outcome AND a finite plan P&L: the win predicate
 *  (isZeroDteWin) keys on the pnl while this one keys on the outcome, so a PARTIAL
 *  write — outcome stamped but pnl still NULL (two column writes, a crash
 *  between them, a NUMERIC that failed to coerce) — used to count as graded-but-not-a-win,
 *  i.e. silently booked a LOSS. Requiring a finite pnl here means the two predicates can
 *  never disagree: a row missing its pnl is ungraded (retried), not a phantom loss. Both read
 *  the OFFICIAL (executable, WS-10) lane with a mid fallback so the graded set is identical
 *  across the record, calibration, and the feature store. */
export function isGradedZeroDteRow(row: OfficialGradableRow): boolean {
  const outcome = officialPlanOutcome(row);
  const pnl = officialPlanPnlPct(row);
  return outcome != null && outcome !== "ungradeable" && pnl != null && Number.isFinite(pnl);
}

/** Win = positive OFFICIAL (executable, WS-10) plan P&L — identical to the calibration
 *  harness's definition AND the feature store's labelFromPlanOutcome (feature-store.ts), so
 *  the member-facing record, the internal calibration, and the learning store can never
 *  disagree on what a win is. In particular a GREEN time_stop is a win in all three. */
export function isZeroDteWin(row: OfficialGradableRow): boolean {
  return (officialPlanPnlPct(row) ?? 0) > 0;
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
  source: "reconstructed" | "engine" | "plan" | null;
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

/** MECHANICAL grade view — the fixed -50/+100/15:30 plan grade, on the OFFICIAL
 *  (conservative-executable, WS-10) lane with a mid fallback for legacy rows. This is the
 *  simulated plan P&L the directive switches to the executable frame; the AS-MANAGED headline
 *  (the engine's realized exit) moves to the executable side separately in WS-11. */
function mechanicalGradeView(row: ZeroDteSetupLogRow): GradeView {
  const graded = isGradedZeroDteRow(row);
  const pnl = graded ? round2(officialPlanPnlPct(row) as number) : null;
  return {
    graded,
    outcome: graded ? officialPlanOutcome(row) : null,
    pnl_pct: pnl,
    win: pnl != null && pnl > 0,
    breakeven: pnl === 0,
    source: null,
  };
}

/** True when a WS-11 reconstruction actually banked a PARTIAL position before its final leg —
 *  i.e. genuinely replays the trim-scale mechanism (real information a single-exit stamp can't
 *  carry: the blended P&L across separate tranches). False for a DEGENERATE reconstruction — one
 *  tranche, `fraction` ≈ 1 — meaning no trim ever armed in the bar-only replay and the whole
 *  position rode straight to the reconstruction's own fixed stop/target/time-stop, exactly like
 *  a plain mechanical grade. A degenerate reconstruction adds NOTHING a real recorded exit
 *  doesn't already know, and — unlike the reconstruction — a real exit reflects live-only engine
 *  logic the bar-only replay structurally cannot reproduce: the ratchet profit floor (armed by a
 *  peak, not implemented in reconstructTrimScaleExecutableFromBars at all) and a thesis-break veto
 *  (needs live GEX-wall/dealer-positioning state, unavailable from price bars). Confirmed live
 *  2026-08-06: MU (peak +16.73%, real ratchet-floor exit +4.99%) and QQQ (real thesis-break exit
 *  -12.43%) both reconstructed to a single degenerate stopped-at-~-50% tranche, silently replacing
 *  a real, better outcome with a worse and later fictitious one on the AS-MANAGED headline. */
function reconstructionShowsGenuinePartialBank(
  entryContext: Record<string, unknown> | null | undefined
): boolean {
  const ex = entryContext?.executable;
  if (!ex || typeof ex !== "object") return false;
  const tranches = (ex as Record<string, unknown>).tranches;
  if (!Array.isArray(tranches) || tranches.length === 0) return false;
  if (tranches.length > 1) return true;
  const only = tranches[0] as Record<string, unknown> | undefined;
  const fraction = typeof only?.fraction === "number" && Number.isFinite(only.fraction) ? only.fraction : 1;
  return fraction < 0.999;
}

function reconstructedGradeView(reco: { plan_outcome: string | null; plan_pnl_pct: number }): GradeView {
  const pnl = round2(reco.plan_pnl_pct);
  return {
    graded: true,
    // The reconstruction's own runner outcome (doubled/stopped/time_stop) is the honest
    // as-managed label; the tranches carry the partial-banking detail behind the blend.
    outcome: reco.plan_outcome,
    pnl_pct: pnl,
    win: pnl > 0,
    breakeven: pnl === 0,
    source: "reconstructed",
  };
}

/** AS-MANAGED grade view — the exit the member was live-guided to take. Precedence:
 *  (1) WS-11 — a TRIM-SCALE row genuinely reconstructed with a PARTIAL scale-out path (2+
 *      tranches, or one tranche with fraction < 1): the reconstruction replays the exact
 *      ⅓/⅓/⅓ scale-out the engine runs, priced executable-side, so it IS the canonical
 *      as-managed number AND the official calibration number (officialPlanPnlPct) — one and
 *      the same, so the headline and the grade agree by construction. It supersedes the live
 *      single-exit stamp for these rows (FINDINGS 2026-08-06: gated on GENUINE partial
 *      banking — a degenerate single-tranche "reconstruction" is not preferred over a real
 *      recorded exit; see reconstructionShowsGenuinePartialBank).
 *  (2) the live engine's stamped single exit (entry_context.exit) — ratchet mode, thesis/flat,
 *      OR a trim_scale row whose reconstruction never actually armed a trim.
 *  (3) no engine exit → the reconstruction (even if degenerate) if present, else the play rode
 *      to the plan's own stop/target/time-stop (mechanical) — never silently ungraded. */
function managedGradeView(row: ZeroDteSetupLogRow): GradeView {
  const reco = readReconstructedTrimScale(row.entry_context);
  if (reco && reconstructionShowsGenuinePartialBank(row.entry_context)) {
    return reconstructedGradeView(reco);
  }
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
  if (reco) return reconstructedGradeView(reco);
  const mech = mechanicalGradeView(row);
  return { ...mech, source: mech.graded ? "plan" : null };
}

/** WS-11 — the member-facing AS-MANAGED plan P&L for a row (the same number managedGradeView's
 *  headline reports). Exported so the grade path (scan.ts) can measure
 *  grade_vs_asmanaged_delta = officialPlanPnlPct(row) − asManagedPnlPct(row) and confirm the
 *  reconciliation holds (≈ 0 for a reconstructed TRIM-SCALE row). Null when the row is ungraded. */
export function asManagedPnlPct(row: ZeroDteSetupLogRow): number | null {
  const view = managedGradeView(row);
  return view.graded ? view.pnl_pct : null;
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
    // The per-play "plan" column reflects the OFFICIAL (executable, WS-10) lane so the public
    // record shows the return a member could have exited at; mid stays on the live board.
    plan_outcome: officialPlanOutcome(r),
    plan_pnl_pct: officialPlanPnlPct(r) != null ? round2(officialPlanPnlPct(r) as number) : null,
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
