// 0DTE Command multi-day track record (proposal P-3, docs/audit/NIGHTHAWK-VS-SLAYER-0DTE.md §5;
// build item 3 of the decision doc). Until this module, the platform's most ACTIVE play
// surface was the only one whose record members could not see: zerodte_setup_log rows are
// graded per-play (plan_outcome/plan_pnl_pct + direction_hit), but no API aggregated them —
// the board serves today only, and /api/track-record covered Slayer + Night Hawk editions.
//
// Pure functions over already-fetched ledger rows (the route does the fetching), so the
// aggregation math is unit-tested against fixture ledgers — including the real 7/13 session
// (1W/7L) whose shape motivated the whole audit. Methodology discipline (hard rule from the
// decision doc §3): these are PLAN-OUTCOME grades on option premium (−50%/+100%/15:50 plan) —
// NEVER blend them with SPX Slayer's pnl-points or Night Hawk's stock-move percentages.

import type { ZeroDteSetupLogRow } from "@/lib/db";
import { buildCondorRecord, isCondorRow, type CondorRecord } from "./condor-record";
import { categorizeExitReason } from "./exit-engine";
import { etMinutesOf, PLAN_RULES, PLAN_RULES_TIME_STOP_ET_LABEL } from "./plan";
import { roundTrailingRuleDisplay } from "./strategy-version";
import { tierFromEntryContext, type ZeroDteTier } from "./tiers";

/** Methodology label served with every payload built here — the honest-record rule.
 *  The headline record is the AS-MANAGED grade: the exit the member is actually
 *  live-guided to take (the exit engine's realized ratchet / thesis-break / flat-timeout
 *  / plan stop-or-target exit, stamped at entry_context.exit), falling back to the fixed
 *  mechanical plan grade only when no engine exit fired (the play rode the plan's own
 *  stop/target/time-stop). The fixed -50/+100/time-stop plan grade is kept alongside as a
 *  labeled comparison (`mechanical`), never as the member-facing number — the time-stop
 *  digits below are interpolated from PLAN_RULES, never hardcoded: a hardcoded "15:30"
 *  copy of this string (stale since the engine's time stop moved to 15:50) shipped on the
 *  public /methodology page while other copy on the SAME page correctly said 15:50, an
 *  unreproducible contradiction on the page that exists specifically to let members
 *  reproduce the ledger. See FINDINGS 2026-09-02. */
export const ZERODTE_RECORD_METHODOLOGY =
  "0DTE Command results are AS-MANAGED grades: the exit the member was live-guided to " +
  "take (profit-ratchet, thesis-break, flat-timeout, or the printed plan's stop/target), " +
  "on the option's own premium, from the scanner ledger (every committed setup, no " +
  `cherry-picking). A win is positive realized P&L. The fixed ${PLAN_RULES.stop_pct}%/+${PLAN_RULES.target_pct}%/${PLAN_RULES_TIME_STOP_ET_LABEL}-ET plan ` +
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
  /** Dossier-scored Night Hawk letter when the row's origin has options-flow evidence to
   *  score (FLOW), else the PR-F merit tier as a real fallback (toPlay's own doc comment
   *  has the full mechanism) — never a bare null when SOME rank exists for the play. Null
   *  only when the row genuinely carries no pinned evidence at all (pre-C-2 rows). */
  conviction: string | null;
  /** MECHANICAL plan grade (fixed -50/+100/15:50) — the labeled comparison, not the
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
  /** HONEST maximum favorable excursion — how high this position's REAL mark got before it
   *  closed, reported SEPARATELY from managed_pnl_pct (the realized/as-managed result) so the
   *  two are never conflated in a report (member audit directive: "separate realized exits
   *  from maximum potential gains"). null when the row never carried a live-managed exit
   *  (still open, or a pre-exit-engine legacy row) — absence, never a fabricated zero. See
   *  extractMaxFavorablePct's own doc for the exact source. */
  max_favorable_pct: number | null;
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
  /** The fixed -50/+100/15:50 plan grade over the SAME rows — labeled comparison only,
   *  never the member-facing headline (see ZERODTE_RECORD_METHODOLOGY). Identical to the
   *  headline whenever no engine exit fired on any row (the clean hold-to-plan path). */
  mechanical: ZeroDteRecordRollup;
  /** The iron condor's OWN record — a structurally different instrument (WIN=inside/LOSS=breach),
   *  separated from the directional numbers above so the two opposite skews are never blended.
   *  Usually an explicit "no live record" state: condors are flag-on but rarely commit. */
  condor: CondorRecord;
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

/** FINDINGS 2026-08-27: when a row carries a GENUINE trim-scale reconstruction (WS-11) that a
 *  real, live-only exit (thesis-break/ratchet-floor/flat-timeout) should outrank — see
 *  realExitIsBarWalkReproducible below — the OFFICIAL number must follow that real exit too, not
 *  just the as-managed headline (managedGradeView). Without this, officialPlanPnlPct keeps
 *  reading entry_context.executable.plan_pnl_pct, which scan.ts stamps as the RECONSTRUCTION'S
 *  OWN blended number for any row carrying a `tranches` array (WS-11's design: "presence of
 *  tranches is the signal the OFFICIAL number IS the as-managed path") — so the calibration
 *  lane and the feature store (both of which read officialPlanPnlPct, never managedGradeView)
 *  would keep grading the fictitious reconstruction even after the member-facing headline above
 *  was fixed. Returns null when no override applies (ratchet-mode/legacy rows, or a genuine
 *  reconstruction the real exit does NOT need to outrank) — callers fall through unchanged. */
function officialOverridingRealExit(
  entryContext: Record<string, unknown> | null | undefined
): { plan_outcome: string | null; plan_pnl_pct: number } | null {
  const reco = readReconstructedTrimScale(entryContext);
  if (!reco || !reconstructionShowsGenuinePartialBank(entryContext)) return null;
  const exit = readManagedExit(entryContext);
  if (!exit || exit.pnl_pct == null || realExitIsBarWalkReproducible(exit.reason)) return null;
  // FINDINGS 2026-11-01: this lane reads the SAME frozen entry_context.exit blob
  // managedGradeView() does, for the exact same real-exit-outranks-reconstruction rows — but
  // until this fix it served exit.pnl_pct RAW while managedGradeView() (line ~572) clamps it to
  // the row's own peak_pnl_pct via clampManagedPnlToPeak (added 2026-10-31 for the identical
  // "a position can never realize better than its own recorded peak" reason documented on that
  // function above). Without the same clamp here, the two "official" numbers for one position
  // could disagree, and plan_pnl_pct — the number calibration/feature-store/Largo's
  // get_zerodte_record read, per the module comment above — could exceed max_favorable_pct,
  // which is mathematically impossible. Reusing clampManagedPnlToPeak (not reimplementing it)
  // keeps both lanes mechanically unable to drift apart again.
  const pnl = round2(clampManagedPnlToPeak(exit.pnl_pct, exit.peak_pnl_pct));
  return { plan_outcome: managedOutcomeLabel(exit.reason, pnl), plan_pnl_pct: pnl };
}

/** The OFFICIAL per-row plan P&L: the executable lane when the row carries it, else the mid
 *  column (legacy) — corrected (2026-08-27) to defer to a real live-only exit over a GENUINE
 *  trim-scale reconstruction, mirroring managedGradeView so the two lanes can never disagree.
 *  This is the number calibration buckets and the record grades on. */
export function officialPlanPnlPct(row: OfficialGradableRow): number | null {
  const override = officialOverridingRealExit(row.entry_context);
  if (override) return override.plan_pnl_pct;
  return readExecutableGrade(row.entry_context)?.plan_pnl_pct ?? row.plan_pnl_pct;
}

/** The OFFICIAL per-row plan outcome label — the executable lane's outcome when present, else
 *  the mid column. Kept in lockstep with officialPlanPnlPct so the label and the pnl agree
 *  (including the 2026-08-27 real-exit override above). */
export function officialPlanOutcome(row: OfficialGradableRow): string | null {
  const override = officialOverridingRealExit(row.entry_context);
  if (override) return override.plan_outcome;
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
//
// CORRECTED 2026-08-27: "by construction" held only because nothing checked whether a REAL,
// terminal exit had already closed the position for a reason (thesis-break/ratchet-floor/
// flat-timeout) the bar-walk reconstruction is structurally blind to — the reconstruction then
// keeps "trading" bars against an already-closed position and produces a fictitious number. 90-day
// prod pull: 94/104 reconstructed rows also carried a real entry_context.exit, 43/94 (46%)
// sign-flipping the displayed outcome. See realExitIsBarWalkReproducible + managedGradeView's
// updated precedence, and officialOverridingRealExit (keeps officialPlanPnlPct/officialPlanOutcome
// — read by calibration + feature-store, NOT by managedGradeView — in lockstep with the same fix).

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
// A row is graded twice: MECHANICAL (the fixed -50/+100/15:50 plan grade, from
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
): { reason: string | null; pnl_pct: number | null; peak_pnl_pct: number | null } | null {
  const exit = entryContext?.exit;
  if (!exit || typeof exit !== "object") return null;
  const e = exit as Record<string, unknown>;
  const pnl = typeof e.pnl_pct === "number" && Number.isFinite(e.pnl_pct) ? e.pnl_pct : null;
  const reason = typeof e.reason === "string" ? e.reason : null;
  // peak_pnl_pct (2026-10-20, member audit directive: "separate realized exits from maximum
  // potential gains") — the live-managed MAXIMUM FAVORABLE EXCURSION this position reached
  // before it closed, already stamped by the exit engine on every live-managed exit but never
  // promoted past this nested blob to a labeled, top-level record field (see
  // extractMaxFavorablePct below). Never fabricated: absent/non-finite reads null, same
  // discipline as pnl_pct/reason above.
  const peak = typeof e.peak_pnl_pct === "number" && Number.isFinite(e.peak_pnl_pct) ? e.peak_pnl_pct : null;
  return { reason, pnl_pct: pnl, peak_pnl_pct: peak };
}

/**
 * The HONEST maximum-favorable-excursion for one row — "how high did this position actually
 * get before it closed," reported SEPARATELY from the realized/as-managed P&L so a member or
 * Largo answer never conflates the two (member audit directive, point 6 of the original brief:
 * "separate realized exits from maximum potential gains"). Sourced from the SAME live-managed
 * exit stamp `managedGradeView`/`readManagedExit` already read — not a second, independently-
 * computed peak, so this can never disagree with the engine's own tracking. Returns null (never
 * a fabricated peak) when the row never carried a live-managed exit at all (e.g. still open, or a
 * pre-exit-engine legacy row) — an ungraded/no-peak row is absence, not zero.
 */
export function extractMaxFavorablePct(entryContext: Record<string, unknown> | null | undefined): number | null {
  const exit = readManagedExit(entryContext);
  return exit?.peak_pnl_pct ?? null;
}

/** Map an engine EXIT reason (exit-engine.ts) to a record outcome bucket. Only EXIT
 *  decisions stamp entry_context.exit, so the reason is always one of the exit reasons.
 *
 *  FIXED 2026-09-22: this used to hand-roll its own ad hoc checks + a `/ratchet|runner/`
 *  substring regex instead of reusing `categorizeExitReason` (exit-engine.ts), the module's
 *  OWN authoritative reason→family classifier (already imported here and already trusted by
 *  `realExitIsBarWalkReproducible` above). Two real trim-scale-mode EXIT reasons this file's
 *  ad hoc regex never accounted for correctly:
 *    - `trim_scale_dead_zone_floor` (the trim-scale regime dead-zone's own protective floor,
 *      exit-engine.ts's decideTrimScale) contains neither "ratchet" nor "runner", so it fell
 *      all the way through to the bare win/loss/breakeven-by-sign label — the ONE real,
 *      live-stampable EXIT reason this function had no case for at all, silently missing from
 *      every by_outcome breakdown a member/Largo reads.
 *    - `trim_scale_runner_target` (both tranches banked AND the final third also tags the
 *      plan target — the trim-scale analogue of ratchet mode's `plan_target_final`/"doubled")
 *      DOES contain the substring "runner", so the old regex mislabeled a genuine, full
 *      profit-TARGET capture as "ratchet" (a defensive floor exit) — conflating two outcome
 *      shapes by_outcome exists specifically to keep apart. Confirmed reachable live: this
 *      exact reason is stamped whenever a trim_scale row's real engine exit is graded without
 *      (or ahead of) its WS-11 bar-walk reconstruction — see managedGradeView's precedence
 *      just above, and the two live fixture reproductions from #4939/#4941-era rows in this
 *      module's own tests that stamp `trim_scale_runner_target` as a REAL exit reason.
 *  `categorizeExitReason`'s prefix ordering already resolves both correctly (dead-zone floor is
 *  an exact match checked BEFORE the general `trim_scale`-prefix "target" bucket), so mapping
 *  its four categories straight onto the record's outcome vocabulary fixes both, and keeps this
 *  function from ever drifting out of sync with the module its own realExitIsBarWalkReproducible
 *  already depends on for the same reason string. */
function managedOutcomeLabel(reason: string | null, pnl: number): string {
  // Missing/unknown/future reason: bucket by sign rather than mislabel it as a known outcome.
  const bySign = pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven";
  if (reason == null) return bySign;
  switch (categorizeExitReason(reason)) {
    case "stop":
      // "stop" is EXCLUSIVELY plan_stop, which only ever fires when the mark has fallen
      // to/below the fixed -50% plan stop (exit-engine.ts) — a positive pnl under this reason
      // is a pre-existing frozen-data contradiction (e.g. the entryBasisDiverged-era rows this
      // module's own history already names), not a genuine stop-out. Read-time reconciliation,
      // same discipline as clampManagedPnlToPeak/withRoundedTrailingRuleDisplay elsewhere in
      // this file — never mutates the stored row, only the label a future read renders.
      return pnl > 0 ? bySign : "stopped";
    case "target":
      // "target" (plan_target*/trim_scale*, dead-zone floor excluded above) is exclusively a
      // profit-taking exit — a non-positive pnl under this reason is the same contradiction
      // class, the other direction.
      return pnl > 0 ? "doubled" : bySign;
    case "ratchet":
      return "ratchet";
    case "thesis":
      return "thesis_break";
    case "flat":
      return "flat_scratch";
    default:
      // categorizeExitReason fails CLOSED (null) on an unrecognized/future reason — bucket by
      // sign rather than mislabel it as a known outcome, same discipline as the null-reason case.
      return bySign;
  }
}

/** MECHANICAL grade view — the fixed -50/+100/15:50 plan grade, on the OFFICIAL
 *  (conservative-executable, WS-10) lane with a mid fallback for legacy rows. This is the
 *  simulated plan P&L the directive switches to the executable frame; the AS-MANAGED headline
 *  (the engine's realized exit) moves to the executable side separately in WS-11. */
function mechanicalGradeView(row: OfficialGradableRow): GradeView {
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

// ── FINDINGS 2026-08-27: a REAL, TERMINAL live-only exit must outrank the reconstruction ────
// reconstructionShowsGenuinePartialBank only asks "did the bar-walk trim more than once" — it
// never asks whether a real recorded exit (entry_context.exit) closed the position for a reason
// the bar-walk is structurally blind to. reconstructTrimScaleExecutableFromBars (plan.ts)
// replays the frozen ⅓/⅓/⅓ tranche ladder against raw minute bars ONLY — it has no notion of
// Cortex veto, GEX-wall thesis-break, or the ratchet floors, all of which are LIVE state the
// exit engine (exit-engine.ts) computes tick-by-tick and nothing else can reconstruct after the
// fact. So whenever the real exit fired for one of those live-only reasons, the reconstruction
// is not "more information" (the 2026-08-06 fix's framing) — it is a fictitious continuation of
// a position that was already closed. Live evidence (90-day prod pull, 2026-08-27): 94/104
// reconstructed rows also carried a real entry_context.exit; 43/94 (46%) sign-flipped the
// displayed outcome (APLD +19% thesis_break shown as -0.98% time_stop; MU -21.92% thesis_break
// shown as +56.93%; SPXW exactly-0% ratchet_breakeven_floor shown as +56.07%).
//
// The fix is NOT "always prefer the real exit" — a genuine multi-tranche bank still carries real
// information the moment the real exit's OWN reason is something the bar-walk can faithfully
// replay (a plain premium stop, or the trim-scale ladder's own target/tranche exits — the exact
// mechanism the reconstruction models). It is only THESIS/RATCHET/FLAT-family reasons — states
// requiring live Cortex/GEX-wall/dealer-positioning knowledge — that the reconstruction can never
// see coming and must therefore defer to. categorizeExitReason (exit-engine.ts) is the existing,
// single source of truth for this split: "stop" (plan_stop) and "target" (plan_target*/
// trim_scale*) are bar-walk-reproducible; "thesis", "ratchet", and "flat" are live-only.
function realExitIsBarWalkReproducible(reason: string | null): boolean {
  const category = categorizeExitReason(reason);
  // An unrecognized/future reason token fails CLOSED toward trusting the real exit over a
  // reconstruction we cannot vouch for — this is a real-money grading number, so an unknown
  // category must never silently unlock the reconstruction's precedence.
  return category === "stop" || category === "target";
}

/**
 * Read-time-only display clamp (FINDINGS 2026-10-31). A live-managed exit can never
 * realize a BETTER outcome than its own recorded peak — peak_pnl_pct is the highest
 * premium this exact position ever reached before it closed (see extractMaxFavorablePct's
 * doc), so a realized pnl_pct numerically ABOVE it is a mathematical impossibility, not a
 * real result. A live audit of `GET /api/market/zerodte/record?days=90` found exactly that:
 * 7 real rows (NVDA 2026-08-28, OCUL 2026-08-18, HIMS 2026-08-19, KORU 2026-08-13,
 * SPCH 2026-08-12, RIOT 2026-08-11, FIG 2026-08-10) where `managed_pnl_pct` exceeded
 * `max_favorable_pct` by 0.5-1.2 points, every one dated strictly BEFORE the 2026-09-04
 * fix in exit-engine.ts's `buildExitContext` (see that fix's own "BUG FIX (2026-09-04)"
 * comment) shipped 2026-09-03 — zero such rows in any September/October pull since.
 *
 * Root cause (confirmed by reading the pre-fix diff, commit f42a3892b/#3445): for a
 * NON-honored exit (thesis/plan_stop/flat), the OLD formula computed `pnl_pct` from
 * `resolveExitMark`'s `round2(observedMark)` — the raw mid rounded to the nearest cent —
 * while `peak_pnl_pct` was (and still is) computed from the UNROUNDED `peakPremium`
 * (exit-sync.ts's `peak = Math.max(row.peak_premium, mark)`, built from the same raw,
 * pre-rounding mark). Cent-rounding a raw mid that sits just below a half-cent boundary
 * (e.g. 2.265 -> 2.27) rounds UP past the row's own genuine high-water mark whenever that
 * mark is a cheap, sub-few-dollar 0DTE premium — exactly the "several points" the fix's own
 * comment warns a sub-$1 lotto premium can lose to this rounding. The fix (now live for
 * every fresh exit) uses the raw `observedMark` instead on the non-honored path, so
 * `pnl_pct <= peak_pnl_pct` holds by construction going forward — but the ~7 rows that
 * already exited under the old formula have it baked into their immutable
 * `entry_context.exit` blob (first-write-wins, never rebuilt — scan.ts's own documented
 * discipline), and this module used to serve `pnl_pct` from that blob verbatim.
 *
 * There is no way to recover the TRUE pre-rounding `pnl_pct` retroactively — the raw,
 * unrounded mark was only ever used transiently to compute it and was never itself
 * persisted (only the already-cent-rounded `mark`/`mark_observed` survive) — so this
 * clamps the DISPLAYED `pnl_pct` to the row's own `peak_pnl_pct` (the one number in the
 * same frozen blob the 2026-09-04 bug never touched) rather than fabricate a new precise
 * figure: the honest statement available is "this realized at best as well as its own
 * recorded peak," not a specific percentage weaker than that. Mirrors the read-time
 * display-only precedent `withRoundedTrailingRuleDisplay` below (same "fix the stamp, not
 * the past" shape, different frozen field). A no-op, provably, whenever the invariant
 * already holds — which post-fix rows and every pre-fix HONORED floor/stop exit (never
 * affected; same exit-sync.ts guarantee) already do — so this can never move a correct
 * number, only cap an impossible one.
 */
function clampManagedPnlToPeak(pnl: number, peak: number | null): number {
  return peak != null && Number.isFinite(peak) && pnl > peak ? peak : pnl;
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
 *      single-exit stamp for these rows, but ONLY under BOTH of:
 *        (a) FINDINGS 2026-08-06: GENUINE partial banking (2+ tranches, or one tranche with
 *            fraction < 1) — a degenerate single-tranche "reconstruction" is never preferred
 *            over a real recorded exit (see reconstructionShowsGenuinePartialBank), and
 *        (b) FINDINGS 2026-08-27: no real recorded exit exists, OR the real exit's own reason
 *            is one the bar-walk can faithfully reproduce (a plain premium stop, or the
 *            trim-scale ladder's own target/tranche exits — see
 *            realExitIsBarWalkReproducible). A real exit whose reason needs LIVE state the
 *            bar-walk structurally cannot see (thesis-break, any ratchet floor, flat-timeout)
 *            always wins — the reconstruction is not "more information" there, it is a
 *            fictitious continuation of an already-closed position (see repro evidence above
 *            realExitIsBarWalkReproducible).
 *  (2) the live engine's stamped single exit (entry_context.exit) — ratchet mode, thesis/flat,
 *      a trim_scale row whose reconstruction never actually armed a trim, OR a genuine
 *      reconstruction whose real-exit counterpart is a live-only reason per (1b).
 *  (3) no engine exit → the reconstruction (even if degenerate) if present, else the play rode
 *      to the plan's own stop/target/time-stop (mechanical) — never silently ungraded. */
function managedGradeView(row: OfficialGradableRow): GradeView {
  const reco = readReconstructedTrimScale(row.entry_context);
  const exit = readManagedExit(row.entry_context);
  const hasRealTerminalExit = exit != null && exit.pnl_pct != null;
  // A real exit blocks the reconstruction's precedence unless the exit's OWN reason is one the
  // bar-walk reconstruction can faithfully reproduce (see realExitIsBarWalkReproducible above).
  const realExitBlocksReconstruction =
    hasRealTerminalExit && !realExitIsBarWalkReproducible(exit.reason);
  if (
    reco &&
    reconstructionShowsGenuinePartialBank(row.entry_context) &&
    !realExitBlocksReconstruction
  ) {
    return reconstructedGradeView(reco);
  }
  if (hasRealTerminalExit) {
    const pnl = round2(clampManagedPnlToPeak(exit.pnl_pct as number, exit!.peak_pnl_pct));
    return {
      graded: true,
      outcome: managedOutcomeLabel(exit!.reason, pnl),
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
 *  reconciliation holds (≈ 0 for a reconstructed TRIM-SCALE row). Null when the row is ungraded.
 *  Typed on the narrower `OfficialGradableRow` (not the full `ZeroDteSetupLogRow`) so governor.ts
 *  can call this directly off its own `GovernorLedgerRow` Pick — see that file's
 *  ledgerRowRealizedPnlPct for why it needs the SAME as-managed precedence this function already
 *  implements, not the raw mechanical `plan_pnl_pct` column. */
export function asManagedPnlPct(row: OfficialGradableRow): number | null {
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

/**
 * Read-time-only display fix (2026-10-26, follow-up to the 2026-10-06 fix in
 * strategy-version.ts's buildResolvedExitPolicy — see its own BUG comment for the full
 * story). Any row COMMITTED BEFORE 2026-10-06 froze the OLD, unrounded
 * `tranche_fraction=0.3333333333333333` string into ITS OWN immutable
 * entry_context.exit_policy_snapshot.trailing_rule at commit time (scan.ts freezes this
 * blob per-row — see scan.ts's "readFrozenExitPolicy reads it... graders replay this row
 * under the numbers it COMMITTED with" comment; it is never rebuilt after commit). toPlay()
 * used to serve `entry_context` verbatim, so those ~30 historical rows kept leaking the raw
 * 16-digit float through `/api/market/zerodte/record` (and therefore `get_zerodte_record`)
 * even after the write-time fix made every FRESH commit clean.
 *
 * Rounds ONLY the display copy of `trailing_rule`, on a shallow clone — `config_hash` (and
 * every other field, on `entry_context` or `exit_policy_snapshot`) is left byte-identical.
 * Mutating config_hash here would silently fork a calibration cohort on a row that has
 * already graded, exactly what the write-time fix's own comment warns against — this
 * function touches strictly fewer fields than that one line of risk. Returns the SAME `ctx`
 * reference when there is nothing to round (no snapshot, no string, or already-rounded), so
 * the common case (fresh rows, condor rows, pre-WS-02 rows) allocates nothing and is
 * provably untouched.
 */
function withRoundedTrailingRuleDisplay(
  ctx: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!ctx) return ctx;
  const snap = ctx.exit_policy_snapshot;
  if (!snap || typeof snap !== "object") return ctx;
  const snapObj = snap as Record<string, unknown>;
  const trailingRule = snapObj.trailing_rule;
  if (typeof trailingRule !== "string") return ctx;
  const rounded = roundTrailingRuleDisplay(trailingRule);
  if (rounded === trailingRule) return ctx;
  return {
    ...ctx,
    exit_policy_snapshot: { ...snapObj, trailing_rule: rounded },
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
  // Computed once, reused for both `conviction`'s fallback and `tier` below — same
  // adapter, same pinned blob, one call.
  const tierAssignment = tierFromEntryContext(r.entry_context);
  return {
    session_date: r.session_date,
    ticker: r.ticker,
    direction: r.direction,
    flagged_at: r.first_flagged_at,
    flagged_et: flaggedEt,
    score: r.score_max,
    // `r.conviction` is the dossier-scored Night Hawk letter (scoreCandidate/assignNighthawkTier
    // over flow/tech/pos/news/smart-money) — board.ts's enrichSetup(setup, dossier) stamps it
    // from `dossier.scored.conviction`. BREAKOUT/PIN-origin setups are discovered from a bare
    // price/volume breakout or a GEX pin, with no options-flow evidence to score, so BOTH
    // discovery call sites (breakout-source.ts, pin-source.ts) pass enrichSetup a hardcoded
    // `null` dossier — there is no flow to fetch a dossier FOR. The column is null for these
    // origins not because the play is unranked, but because this ONE ranking method doesn't
    // apply to them: measured live 2026-09-09, 36/57 (63.2%) committed plays over a 14-day
    // window carried `conviction: null`, essentially all BREAKOUT-origin, vs 18/18 FLOW-origin
    // plays with a real letter — a silent per-origin gap, a direct violation of the Largo
    // product contract's C3 absence principle (a consumer that cannot tell "unranked" from
    // "not this kind of play" reports absence as a finding).
    //
    // A real, already-computed, origin-agnostic signal exists one layer down: the PR-F merit
    // tier (assignZeroDteTier via tierFromEntryContext, right below) is derived from evidence
    // EVERY committed origin pins at commit — score, day-open VIX, Cortex, commit-time —
    // regardless of discovery_origin (buildZeroDteEntryContext, entry-context.ts, runs
    // unconditionally on every commit). It is not a re-derivation of the same dossier letter
    // (different formula, different evidence, deliberately excludes A+ — see tiers.ts's own
    // doc comment) but it IS a real, calibrated, non-fabricated rank for this exact play, on
    // the same A/B/C vocabulary the vocabulary checks elsewhere in this codebase already
    // accept (nighthawk-verifier.ts's VALID_CONVICTION). Falling back to it beats a bare null:
    // omission is honest only when no signal exists at all, and one does here.
    //
    // Read-time fallback (not a commit-time backfill) so this ALSO fixes the 36 already-
    // committed historical rows the live measurement found, the same way `tier` below is
    // already recomputed from the pinned blob rather than trusted from a frozen column.
    // Rows with genuinely no entry_context (pre-C-2, or the rare fail-soft failure) keep a
    // real null here — zero pinned evidence is honestly "unrankable", not a fabricated grade.
    conviction: r.conviction ?? tierAssignment?.tier ?? null,
    // The per-play "plan" column reflects the OFFICIAL (executable, WS-10) lane so the public
    // record shows the return a member could have exited at; mid stays on the live board.
    plan_outcome: officialPlanOutcome(r),
    plan_pnl_pct: officialPlanPnlPct(r) != null ? round2(officialPlanPnlPct(r) as number) : null,
    managed_outcome: managed.outcome,
    managed_pnl_pct: managed.pnl_pct,
    managed_source: managed.source,
    max_favorable_pct: extractMaxFavorablePct(r.entry_context) != null ? round2(extractMaxFavorablePct(r.entry_context) as number) : null,
    direction_hit: r.direction_hit,
    move_pct: r.move_pct != null ? round2(r.move_pct) : null,
    entry_context: withRoundedTrailingRuleDisplay(r.entry_context),
    tier: tierAssignment?.tier ?? null,
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
  const all = [...rows].sort(
    (a, b) => b.session_date.localeCompare(a.session_date) || a.ticker.localeCompare(b.ticker)
  );
  // The directional record is DIRECTIONAL rows only. A sold iron condor is graded WIN=close-inside
  // / LOSS=breach (opposite skew), and blending it into a P&L-sign win rate mixes two instruments.
  // 0 condors in prod today, so this filter is a no-op on the live numbers — but it is what stops
  // the headline from silently absorbing a condor breach the day one commits.
  const condorRows = all.filter((r) => isCondorRow(r.entry_context));
  const sorted = all.filter((r) => !isCondorRow(r.entry_context));
  const condor = buildCondorRecord(
    condorRows.map((r) => ({ plan_outcome: r.plan_outcome, plan_pnl_pct: r.plan_pnl_pct }))
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
    condor,
    available: managed.length > 0,
  };
}
