// src/lib/swing/grade.ts — the MULTI-TRUTH swing grader (PR-8). Pure. Evidence-only.
//
// WHY FIVE INDEPENDENT TRUTHS (not one P&L number): a same-day 0DTE lottery collapses to a single
// −50/+100 outcome, so one number grades it. A multi-SESSION swing thesis does not. The same position
// can fill badly yet still print money, or fill perfectly on a thesis that never played out, or realize
// a small P&L on a move that the exit rule left most of on the table. Netting those into one "score"
// destroys exactly the signal calibration needs: WHICH stage failed. So we grade five orthogonal
// families and NEVER average them — execution (did the fill match the plan?), path (how far did the
// underlying travel for/against us?), thesis (did the archetype's structural call confirm or break, in
// UNDERLYING terms?), management (did the managed exit capture the move vs a naive hold?), and financial
// (the realized scale-out P&L). Each carries its own gradeable/ungradeable flag with a reason, so a
// truncated OPTION series can make financial+management ungradeable while path+thesis (walked on the
// UNDERLYING) still grade honestly — the whole grade never collapses because one feed was thin.
//
// SURVIVORSHIP GUARD (the repo's standing law): the financial truth reuses `gradeBangerScaleOut` — the
// ONE production scale-out grader — verbatim (`gradeSwingScaleOut` is a thin parity wrapper, never a
// reimplementation), and its `ungradeable` verdict is surfaced as-is: a missing entry premium, no
// forward bars, or a series truncated before expiry is reported as `ungradeable` with the reason and
// is NEVER imputed to a multiple. A null is honest; a fabricated 0/1× "realized" is a lie that inflates
// the headline realized rate. Management inherits the same guard (it can only grade what financial could).
//
// CONSERVATIVE INTRABAR ORDERING: in the thesis walk the structural STOP (invalidation) is checked
// BEFORE the target within the same bar — no look-ahead, the same discipline `gradeScaleOut` applies to
// its hard-stop-before-2× test. A bar that straddles both levels resolves to INVALIDATED, never a
// phantom "hit target then stopped" win.

import type { GraderTimeframe } from "../horizons";
import type { PlayDirection } from "../horizon-fanout";
import type { SwingArchetype, SwingSubLane } from "./taxonomy";
import { SWING_SUB_LANES } from "./taxonomy";
import { gradeBangerScaleOut, type BangerScaleOutGrade } from "../zerodte/banger-scale-out-grade";
import type { ScaleOutBar } from "../zerodte/scale-out";

export const SWING_GRADE_VERSION = 1;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/**
 * Which of the five truth families a grader-timeframe query is for. The timeframe a family SHOULD be
 * walked on is not one-size-per-lane: a multi-day directional THESIS is a structural call best judged on
 * the coarse pinned lane bars (a 22–30d EXTENDED thesis confirms/breaks on DAILY structure, not on
 * intrabar noise), while the FINANCIAL P&L and the PATH excursion (MFE/MAE/stop-touch) are point-in-time
 * measurements that only get MORE honest with finer bars. EXECUTION reads a single fill (no bar walk) and
 * MANAGEMENT reuses FINANCIAL's exact option series, so they inherit FINANCIAL's preference.
 */
export type SwingGradeDimension = "EXECUTION" | "PATH" | "THESIS" | "MANAGEMENT" | "FINANCIAL";

/** Sub-daily = the finer resolution FINANCIAL/PATH want for real P&L / MFE / MAE / stop-touch. */
const isIntraday = (tf: GraderTimeframe): boolean => tf === "minute" || tf === "hour";

/**
 * The grader timeframe a sub-lane's truth family is walked on. The base is pinned per lane (SEV-9): the
 * short TACTICAL lane resolves on minutes, STANDARD on hours, EXTENDED on days — read from the ONE
 * canonical taxonomy (`SWING_SUB_LANES[x].grader`) so it never drifts from the sub-lane spec. A null
 * sub-lane (no DTE / outside [2,30]) falls back to the coarsest ("day"), the conservative default that
 * never over-claims minute-level resolution we don't have.
 *
 * REFINEMENT (design-critique #8): the base timeframe is right for THESIS (the multi-day directional call
 * — keep it byte-for-byte), but too coarse for the FINANCIAL P&L and PATH excursion, which want intraday
 * resolution when it exists. So for PATH/FINANCIAL/MANAGEMENT a DAILY-pinned lane (the EXTENDED sub-lane)
 * refines to HOUR — the finer bar that actually captures MFE/MAE/stop-touch a daily bar smears over.
 * Lanes already pinned intraday (TACTICAL=minute, STANDARD=hour) are already fine enough and stay put.
 * Callers omit `gradeDimension` to get the unchanged pinned base (backward-compatible). This returns the
 * DESIRED timeframe; whether the finer series is actually AVAILABLE is a runtime decision the grader
 * makes, and when it isn't the grader safely degrades back to the daily series (finer-when-present,
 * never a failure).
 */
export function graderTimeframeForSubLane(
  subLane: SwingSubLane | null,
  gradeDimension?: SwingGradeDimension,
): GraderTimeframe {
  const pinned: GraderTimeframe = subLane == null ? "day" : SWING_SUB_LANES[subLane].grader;
  // THESIS (and the omitted-dimension default + the bar-less EXECUTION fill check) keep the canonical
  // pinned lane timeframe — unchanged, so the thesis conclusion never moves.
  if (gradeDimension == null || gradeDimension === "THESIS" || gradeDimension === "EXECUTION") {
    return pinned;
  }
  // PATH / FINANCIAL / MANAGEMENT prefer intraday: refine a coarse DAILY lane to HOURLY for the P&L /
  // excursion measurement; a lane already on intraday bars keeps its finer timeframe.
  return pinned === "day" ? "hour" : pinned;
}

/** A forward UNDERLYING bar (Polygon AggBar shape; `t` optional there, dropped if non-finite). */
export type UnderlyingBar = { t?: number; o?: number; h: number; l: number; c: number };

export interface SwingExecutionTruth {
  gradeable: boolean;
  reason?: string;
  plannedEntryPx: number | null;
  actualEntryPx: number | null;
  /** Signed so POSITIVE = adverse (worse than plan) for the position's direction; % of planned px. */
  adverseSlippagePct: number | null;
  /** Bounded transform of adverse slippage: 1 = filled at/better than plan, decays as slippage grows. */
  quality01: number | null;
}

export interface SwingPathTruth {
  gradeable: boolean;
  reason?: string;
  graderTimeframe: GraderTimeframe;
  /** How many forward bars were walked. */
  bars: number;
  /** Max FAVORABLE excursion of the underlying vs entry, in the position's direction (% ; ≥ 0). */
  mfePct: number | null;
  /** Max ADVERSE excursion of the underlying vs entry (% ; ≤ 0). */
  maePct: number | null;
}

export type SwingThesisOutcome = "CONFIRMED" | "INVALIDATED" | "OPEN";

export interface SwingThesisTruth {
  gradeable: boolean;
  reason?: string;
  archetype: SwingArchetype | null;
  /** CONFIRMED = target reached; INVALIDATED = structural stop hit (checked first intrabar); OPEN = neither. */
  outcome: SwingThesisOutcome | null;
}

export interface SwingManagementTruth {
  gradeable: boolean;
  reason?: string;
  scaleOutMult: number | null;
  holdMult: number | null;
  /** Best the option ever showed: peak forward-bar high / entry premium (the move that WAS available). */
  optionMfeMult: number | null;
  /** Fraction of the available option move the managed exit captured: (realized−1)/(mfe−1). */
  captureRatio: number | null;
  /** Managed realized minus naive hold-to-expiry — was the scale-out/stop well-timed? */
  edgeVsHold: number | null;
}

export interface SwingFinancialTruth {
  /** Reported SEPARATELY, never imputed to a number — the thin-forward-series survivorship guard. */
  ungradeable: boolean;
  reason?: string;
  scaleOutRealizedMult: number | null;
  holdMult: number | null;
}

export interface SwingGrade {
  v: number;
  subLane: SwingSubLane | null;
  direction: PlayDirection | null;
  graderTimeframe: GraderTimeframe;
  execution: SwingExecutionTruth;
  path: SwingPathTruth;
  thesis: SwingThesisTruth;
  management: SwingManagementTruth;
  financial: SwingFinancialTruth;
}

export interface SwingGradeInput {
  /** Resolves the grader timeframe + is echoed on the grade for the calibration partition. */
  subLane: SwingSubLane | null;
  /** Position direction (from the dossier). Path/thesis need it to know which way is favorable. */
  direction: PlayDirection | null;
  /** The classified archetype label — echoed for the thesis-truth partition (does not gate the walk). */
  archetype?: SwingArchetype | null;

  // ── execution: entry-quality vs the entry model ──
  /** Underlying price the entry model targeted. */
  plannedEntryPx?: number | null;
  /** Where the entry ACTUALLY filled — null until a real fill (the `actualFill:null` discipline). */
  actualEntryPx?: number | null;

  // ── thesis: structural, in UNDERLYING terms ──
  /** Structural stop in the underlying (LONG: a low; SHORT: a high). */
  thesisInvalidationPx?: number | null;
  /** Thesis target in the underlying (LONG: a high; SHORT: a low). */
  targetUnderlyingPx?: number | null;

  // ── path + thesis: forward UNDERLYING bars on the grader timeframe ──
  // THESIS always walks these (the canonical pinned/daily series — its structural call). PATH walks
  // these too UNLESS `intradayUnderlyingBars` is supplied (see below).
  underlyingBars?: UnderlyingBar[];
  /** OPTIONAL finer-than-daily forward UNDERLYING bars (design-critique #8). PATH uses these WHERE
   *  PRESENT so MFE/MAE/stop-touch resolve at intraday granularity; when absent PATH degrades to the
   *  daily `underlyingBars` (still graded, just coarser). THESIS NEVER consumes these — the multi-day
   *  directional call stays on the canonical daily series, byte-for-byte unchanged. */
  intradayUnderlyingBars?: UnderlyingBar[];

  // ── management + financial: forward OPTION bars ──
  entryPremium?: number | null;
  optionBars?: ScaleOutBar[];
  /** OPTIONAL finer-than-daily forward OPTION bars. FINANCIAL/MANAGEMENT grade on these WHERE PRESENT
   *  (finer realized-P&L / capture); absent → they fall back to the daily `optionBars`. Same safe
   *  degrade rule as `intradayUnderlyingBars`. */
  intradayOptionBars?: ScaleOutBar[];
  /** Contract expiry (YYYY-MM-DD) — the financial `hold_mult` baseline is hold-to-expiry. */
  expiryYmd?: string | null;
}

/**
 * Financial truth = the ONE production scale-out grader, reused verbatim. This wrapper exists only so
 * swing callers have a swing-named entry point; it MUST stay a pass-through (the parity test asserts it),
 * so the live ledger and the banger research can never drift on the realized-P&L basis.
 */
export function gradeSwingScaleOut(
  entryPremium: number | null,
  bars: ScaleOutBar[],
  expiryYmd?: string | null
): BangerScaleOutGrade {
  return gradeBangerScaleOut(entryPremium, bars, expiryYmd);
}

function usableUnderlying(bars: UnderlyingBar[] | undefined): UnderlyingBar[] {
  return (bars ?? []).filter(
    (b) =>
      finite(b?.h) &&
      finite(b?.l) &&
      finite(b?.c) &&
      b.c > 0 &&
      // SEV-4: drop any bar carrying a PRESENT-but-non-finite timestamp (NaN/Infinity). A poisoned `t`
      // corrupts the time-ordered thesis walk (NaN comparators make the sort undefined) and any
      // path/timestamp math downstream, so a single malformed bar could flip an outcome. An ABSENT
      // `t` (undefined) is still tolerated — the thesis walk falls back to `t ?? 0`, unchanged.
      (b.t == null || Number.isFinite(b.t)),
  );
}

/** Usable forward OPTION bars for the intraday-availability decision (a positive high to measure). */
function usableOption(bars: ScaleOutBar[] | undefined): ScaleOutBar[] {
  return (bars ?? []).filter((b) => finite(b?.h) && b.h > 0);
}

/** Execution: how close did the real fill land to the plan? Ungradeable until a real fill exists. */
function gradeExecution(input: SwingGradeInput): SwingExecutionTruth {
  const planned = finite(input.plannedEntryPx) ? input.plannedEntryPx! : null;
  const actual = finite(input.actualEntryPx) ? input.actualEntryPx! : null;
  const base = { plannedEntryPx: planned, actualEntryPx: actual, adverseSlippagePct: null, quality01: null };
  if (actual == null) return { gradeable: false, reason: "no_fill", ...base };
  if (planned == null || !(planned > 0)) return { gradeable: false, reason: "no_plan", ...base };
  // Adverse slippage is direction-aware: paying UP is adverse for a LONG, being filled LOWER is adverse
  // for a SHORT (you got a worse basis). Positive = worse than plan.
  const raw = (actual - planned) / planned;
  const adverse = (input.direction === "SHORT" ? -raw : raw) * 100;
  // Bounded, monotone transform: 0% adverse → 1.0, 1% adverse → 0.5; favorable slippage caps at 1.0.
  const quality01 = clamp01(1 / (1 + Math.max(0, adverse)));
  return {
    gradeable: true,
    plannedEntryPx: planned,
    actualEntryPx: actual,
    adverseSlippagePct: round2(adverse),
    quality01: round2(quality01),
  };
}

/**
 * Path: MFE/MAE of the underlying vs the entry, in the position's direction, over the chosen bars.
 * `bars` is the already-usable series the caller resolved (finer intraday WHERE PRESENT, else the daily
 * fallback) and `graderTimeframe` is the timeframe those bars actually represent — the two travel
 * together so the reported timeframe never over-claims resolution the bars don't have.
 */
function gradePath(input: SwingGradeInput, bars: UnderlyingBar[], graderTimeframe: GraderTimeframe): SwingPathTruth {
  const entryPx = finite(input.actualEntryPx)
    ? input.actualEntryPx!
    : finite(input.plannedEntryPx)
      ? input.plannedEntryPx!
      : null;
  const base = { graderTimeframe, bars: bars.length, mfePct: null, maePct: null };
  if (input.direction == null) return { gradeable: false, reason: "no_direction", ...base };
  if (entryPx == null || !(entryPx > 0)) return { gradeable: false, reason: "no_entry_px", ...base };
  if (bars.length === 0) return { gradeable: false, reason: "no_forward_bars", ...base };
  let maxHigh = -Infinity;
  let minLow = Infinity;
  for (const b of bars) {
    if (b.h > maxHigh) maxHigh = b.h;
    if (b.l < minLow) minLow = b.l;
  }
  // Favorable = up for LONG, down for SHORT. MFE ≥ 0, MAE ≤ 0.
  const mfe = input.direction === "SHORT" ? (entryPx - minLow) / entryPx : (maxHigh - entryPx) / entryPx;
  const mae = input.direction === "SHORT" ? (entryPx - maxHigh) / entryPx : (minLow - entryPx) / entryPx;
  return {
    gradeable: true,
    graderTimeframe,
    bars: bars.length,
    mfePct: round2(mfe * 100),
    maePct: round2(mae * 100),
  };
}

/**
 * Thesis: did the structural call confirm or break, in UNDERLYING terms? Walks the forward bars in time
 * order; within a bar the invalidation (stop) is tested BEFORE the target — a bar that straddles both
 * resolves to INVALIDATED (no intrabar look-ahead). Needs at least one of {invalidation, target} defined.
 */
function gradeThesis(input: SwingGradeInput): SwingThesisTruth {
  const archetype = input.archetype ?? null;
  const inval = finite(input.thesisInvalidationPx) ? input.thesisInvalidationPx! : null;
  const target = finite(input.targetUnderlyingPx) ? input.targetUnderlyingPx! : null;
  const base = { archetype, outcome: null as SwingThesisOutcome | null };
  if (input.direction == null) return { gradeable: false, reason: "no_direction", ...base };
  if (inval == null && target == null) return { gradeable: false, reason: "no_thesis_levels", ...base };
  const bars = usableUnderlying(input.underlyingBars);
  if (bars.length === 0) return { gradeable: false, reason: "no_forward_bars", ...base };
  const ordered = [...bars].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const isLong = input.direction !== "SHORT";
  for (const b of ordered) {
    // Stop BEFORE target, same bar (conservative — no look-ahead). LONG invalidates on a low breaking
    // below the stop / confirms on a high reaching the target; SHORT is the mirror.
    if (inval != null) {
      if (isLong ? b.l <= inval : b.h >= inval) return { gradeable: true, archetype, outcome: "INVALIDATED" };
    }
    if (target != null) {
      if (isLong ? b.h >= target : b.l <= target) return { gradeable: true, archetype, outcome: "CONFIRMED" };
    }
  }
  return { gradeable: true, archetype, outcome: "OPEN" };
}

/**
 * Management: did the managed scale-out capture the move the OPTION actually offered, vs a naive hold?
 * `optionBars` is the SAME series the financial truth graded (finer intraday WHERE PRESENT, else the
 * daily fallback), so capture/edge are measured on identical bars to the realized P&L.
 */
function gradeManagement(
  input: SwingGradeInput,
  financial: SwingFinancialTruth,
  optionBars: ScaleOutBar[],
): SwingManagementTruth {
  const base = {
    scaleOutMult: financial.scaleOutRealizedMult,
    holdMult: financial.holdMult,
    optionMfeMult: null,
    captureRatio: null,
    edgeVsHold: null,
  };
  // Management can only grade what the financial truth could (it's the same forward series + entry).
  if (financial.ungradeable) return { gradeable: false, reason: financial.reason ?? "financial_ungradeable", ...base };
  const entry = finite(input.entryPremium) ? input.entryPremium! : null;
  const bars = usableOption(optionBars);
  if (entry == null || !(entry > 0) || bars.length === 0) {
    return { gradeable: false, reason: "no_option_bars", ...base };
  }
  let peakHigh = -Infinity;
  for (const b of bars) if (b.h > peakHigh) peakHigh = b.h;
  const optionMfeMult = peakHigh / entry;
  const realized = financial.scaleOutRealizedMult;
  const hold = financial.holdMult;
  // captureRatio: how much of the available (mfe−1) upside the exit realized. Only meaningful when the
  // option actually showed upside (mfe > 1); otherwise null, never a fabricated ratio.
  const captureRatio = optionMfeMult > 1 && realized != null ? (realized - 1) / (optionMfeMult - 1) : null;
  const edgeVsHold = realized != null && hold != null ? realized - hold : null;
  return {
    gradeable: true,
    scaleOutMult: realized,
    holdMult: hold,
    optionMfeMult: round2(optionMfeMult),
    captureRatio: captureRatio == null ? null : round2(captureRatio),
    edgeVsHold: edgeVsHold == null ? null : round2(edgeVsHold),
  };
}

/**
 * Grade a swing position across five independent truth families. Every family is graded on the evidence
 * it owns and carries its own gradeable/ungradeable flag — the grade is never a single number, and a
 * thin option series never voids the underlying-based truths (and vice-versa).
 */
export function gradeSwingPosition(input: SwingGradeInput): SwingGrade {
  // Canonical (pinned) lane timeframe — the THESIS/top-level basis; unchanged by the #8 refinement.
  const graderTimeframe = graderTimeframeForSubLane(input.subLane);

  // ── PATH: prefer the finer intraday underlying WHERE PRESENT, else degrade to the daily series ──
  // Finer-when-available is a strict improvement (an intraday spike a daily bar smears over is now
  // caught); the daily fallback keeps PATH gradeable when no intraday series was fetched — degraded,
  // never a failure. The reported timeframe tracks the series actually walked (no over-claiming).
  const pathPref = graderTimeframeForSubLane(input.subLane, "PATH");
  const intradayUnder = usableUnderlying(input.intradayUnderlyingBars);
  const usePathIntraday = isIntraday(pathPref) && intradayUnder.length > 0;
  const pathBars = usePathIntraday ? intradayUnder : usableUnderlying(input.underlyingBars);
  const pathTimeframe = usePathIntraday ? pathPref : graderTimeframe;

  // ── FINANCIAL + MANAGEMENT: same finer-when-present rule on the OPTION series ──
  // The RAW intraday array is fed to gradeBangerScaleOut (it owns its own truncation/expiry logic), so
  // we only PRE-check availability with `usableOption` rather than pre-filtering the bars it grades.
  const finPref = graderTimeframeForSubLane(input.subLane, "FINANCIAL");
  const hasIntradayOption = usableOption(input.intradayOptionBars).length > 0;
  const useOptionIntraday = isIntraday(finPref) && hasIntradayOption;
  const optionBars = useOptionIntraday ? input.intradayOptionBars ?? [] : input.optionBars ?? [];

  const fin = gradeBangerScaleOut(input.entryPremium ?? null, optionBars, input.expiryYmd ?? null);
  const financial: SwingFinancialTruth = {
    ungradeable: fin.ungradeable,
    reason: fin.reason,
    scaleOutRealizedMult: fin.scale_out_realized_mult,
    holdMult: fin.hold_mult,
  };

  return {
    v: SWING_GRADE_VERSION,
    subLane: input.subLane,
    direction: input.direction,
    graderTimeframe,
    execution: gradeExecution(input),
    path: gradePath(input, pathBars, pathTimeframe),
    thesis: gradeThesis(input),
    management: gradeManagement(input, financial, optionBars),
    financial,
  };
}
