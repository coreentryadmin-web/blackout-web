// src/lib/swing/archetype.ts — the single-winner SWING archetype classifier (PR-3).
//
// The archetype is the CALIBRATION PARTITION (FM#7): a breakout and a mean-reversion must never share a
// scoring/grading bucket, so before anything is weighted (swing-archetype.ts) or graded (calibration.ts) a
// name has to be assigned exactly ONE archetype — or honestly left unclassified. This module does that:
//
//   • one `fitX(inputs) → 0–1 | null` per archetype, scoring how well the name matches that pattern from
//     GROUNDED, direction-signed reads. A fit is `null` when that archetype's evidence is entirely absent —
//     never a fabricated 0 (a 0 says "measured, no fit"; null says "couldn't measure"). They are different.
//   • the winner is the max PRESENT fit, with two honesty guards:
//       – TIE-BREAK: when the top fits sit within a small margin, the more-specific archetype wins, ordered
//         by ARCHETYPE_PRIORITY (taxonomy.ts) — an EVENT_DRIVEN name that also looks like a BREAKOUT is
//         called EVENT_DRIVEN, the more actionable label.
//       – NULL WHEN THIN: if no fit clears a minimal evidence floor, or too few inputs were grounded, the
//         verdict is `archetype:null` — an unclassifiable name is not forced into a bucket.
//   • MARGIN CONFIDENCE = topFit − secondFit is exposed so the desk/gate can see how decisive the call was.
//
// DIRECTION SYMMETRY (the reason `archetypeInputsFromReads` reuses swing-signals): the inputs arrive already
// direction-signed by `swingSignalsFromReads` (LONG on a bull lean / SHORT on a bear lean; price inputs
// signed so a down-move is positive conviction for a SHORT). Because the fits read ONLY those signed 0–1
// fields and never the raw direction, a mirror-image SHORT setup classifies to the SAME archetype with the
// SAME fit as its LONG mirror — conviction, not sign, drives the bucket.
//
// PURE & deterministic — no IO. Evidence-only: this label partitions the score/grade; it sizes nothing.

import type { PlayDirection } from "../horizon-fanout";
import type { SwingReads } from "../swing-signals";
import { swingSignalsFromReads } from "../swing-signals";
import {
  accumulationPersistence,
  relativeStrengthScore,
  trendStackScore,
} from "../horizon-scorers";
import type { SwingArchetype } from "./taxonomy";
import { SWING_ARCHETYPES, ARCHETYPE_PRIORITY } from "./taxonomy";

// ─── Inputs ────────────────────────────────────────────────────────────────────
// Direction-signed, null-safe grounded reads — one signal cluster per archetype. Every field is nullable:
// when the provider that grounds it is absent the field stays `null` and its archetype's fit degrades or
// returns null. NEVER fabricate a value to fill a gap. Each cluster is deliberately disjoint so a fit fires
// on its own evidence and stays low on another archetype's fixture (asserted in the tests).
export interface ArchetypeInputs {
  /** Resolved trade direction (provenance only — the fits never read this, so SHORT mirrors LONG). */
  direction: PlayDirection | null;

  // BREAKOUT — a break from a multi-week base/range on volume.
  /** Proximity to the 20d range extreme IN the trade direction (near-high LONG / near-low SHORT), 0–1. */
  nearRangeExtreme01?: number | null;
  /** Quality of the break (clean close beyond the level, follow-through), 0–1. */
  breakoutQuality01?: number | null;
  /** Volume expansion vs the recent average on the break, 0–1. */
  volumeExpansion01?: number | null;

  // PULLBACK_CONTINUATION — retrace to rising support inside an established trend.
  /** Direction-aligned daily EMA trend-stack (established trend), 0–1. */
  trendStack01?: number | null;
  /** Retrace-to-rising-support geometry (shallow, orderly pullback that holds), 0–1. */
  retraceToSupport01?: number | null;

  // MEAN_REVERSION — oversold snap-back toward the mean.
  /** Oversold in the trade direction (RSI extreme against the move / distance beyond the band), 0–1. */
  oversold01?: number | null;

  // FAILED_BREAKDOWN — lost support that reclaims (a trap reversal).
  /** Strength of the lost-then-reclaimed level (deeper flush + decisive reclaim), 0–1. */
  reclaim01?: number | null;

  // POST_EARNINGS_DRIFT — continuation after an earnings gap.
  /** Recency + size of an aligned earnings gap, 0–1. */
  earningsGapRecent01?: number | null;
  /** Continuation drift in the gap's direction since the print, 0–1. */
  postEarningsDrift01?: number | null;

  // FLOW_ACCUMULATION — stacked directional premium across sessions.
  /** Multi-day accumulation persistence (aligned sessions / window), 0–1. */
  accumPersistence01?: number | null;

  // SECTOR_ROTATION — relative-strength leadership as capital rotates into the group.
  /** Sector RS leadership (the group leads the tape), 0–1. */
  sectorLeadership01?: number | null;
  /** Name relative strength vs SPY (direction-signed), 0–1. */
  relStrength01?: number | null;

  // EVENT_DRIVEN — a known catalyst inside the window drives the thesis.
  /** Catalyst-in-window strength (earnings-momentum / product / FDA / investor-day / gap), 0–1. */
  catalystInWindow01?: number | null;
}

export interface ArchetypeVerdict {
  /** The single winning archetype, or null when the evidence is too thin to classify honestly. */
  archetype: SwingArchetype | null;
  /** The winning archetype's fit (0–1); 0 when nothing was classifiable. */
  confidence: number;
  /** Margin confidence = topFit − secondFit (how decisive the winner was; small ⇒ a priority tie-break). */
  margin: number;
  /** Every archetype's fit — number when grounded, null when its evidence was entirely absent. */
  fits: Record<SwingArchetype, number | null>;
  reason: string;
}

// ─── tuning (provisional priors, not graduated edges) ───────────────────────────
/** Top fit must clear this to earn a label; below it the name is honestly unclassified. */
const EVIDENCE_FLOOR = 0.35;
/** At least one input field must be grounded (some archetypes are single-signal, e.g. EVENT_DRIVEN); the
 *  real thin-guard is the EVIDENCE_FLOOR — a lone weak signal still reads as unclassified. */
const MIN_INPUTS_PRESENT = 1;
/** Two fits within this margin are a "tie" → ARCHETYPE_PRIORITY (most-specific-first) breaks it. */
const MARGIN_EPS = 0.05;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Average the PRESENT members of a signal cluster; null when the whole cluster is absent (evidence gap). */
function blend(...vals: Array<number | null | undefined>): number | null {
  const present = vals.filter(isNum).map(clamp01);
  if (!present.length) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

// ── one fit per archetype (disjoint signal clusters) ────────────────────────────
const fitBreakout = (i: ArchetypeInputs): number | null =>
  blend(i.nearRangeExtreme01, i.breakoutQuality01, i.volumeExpansion01);

const fitPullbackContinuation = (i: ArchetypeInputs): number | null =>
  blend(i.trendStack01, i.retraceToSupport01);

const fitMeanReversion = (i: ArchetypeInputs): number | null => blend(i.oversold01);

const fitFailedBreakdown = (i: ArchetypeInputs): number | null => blend(i.reclaim01);

const fitPostEarningsDrift = (i: ArchetypeInputs): number | null =>
  blend(i.earningsGapRecent01, i.postEarningsDrift01);

const fitFlowAccumulation = (i: ArchetypeInputs): number | null => blend(i.accumPersistence01);

const fitSectorRotation = (i: ArchetypeInputs): number | null =>
  blend(i.sectorLeadership01, i.relStrength01);

const fitEventDriven = (i: ArchetypeInputs): number | null => blend(i.catalystInWindow01);

const FITS: Record<SwingArchetype, (i: ArchetypeInputs) => number | null> = {
  BREAKOUT: fitBreakout,
  PULLBACK_CONTINUATION: fitPullbackContinuation,
  MEAN_REVERSION: fitMeanReversion,
  FAILED_BREAKDOWN: fitFailedBreakdown,
  POST_EARNINGS_DRIFT: fitPostEarningsDrift,
  FLOW_ACCUMULATION: fitFlowAccumulation,
  SECTOR_ROTATION: fitSectorRotation,
  EVENT_DRIVEN: fitEventDriven,
};

/** Count of grounded input fields (excludes `direction`, which is provenance not evidence). */
function presentInputCount(i: ArchetypeInputs): number {
  let n = 0;
  for (const [k, v] of Object.entries(i)) {
    if (k === "direction") continue;
    if (isNum(v as number | null | undefined)) n += 1;
  }
  return n;
}

/**
 * Classify a name into exactly one archetype (single winner), or honestly null when the evidence is thin.
 * Winner = max present fit, with a priority tie-break and a minimal-evidence floor (see file header).
 */
export function classifyArchetype(inputs: ArchetypeInputs): ArchetypeVerdict {
  const fits = {} as Record<SwingArchetype, number | null>;
  for (const a of SWING_ARCHETYPES) {
    const raw = FITS[a](inputs);
    fits[a] = raw == null ? null : round2(raw);
  }

  const present = SWING_ARCHETYPES.map((a) => ({ a, fit: fits[a] })).filter(
    (x): x is { a: SwingArchetype; fit: number } => x.fit != null,
  );

  if (!present.length) {
    return { archetype: null, confidence: 0, margin: 0, fits, reason: "No archetype evidence grounded — unclassifiable." };
  }

  const sorted = [...present].sort((x, y) => y.fit - x.fit);
  const topFit = sorted[0].fit;
  const secondFit = sorted[1]?.fit ?? 0;
  const margin = round2(topFit - secondFit);

  // Tie-break: among all fits within MARGIN_EPS of the top, the most-specific (earliest in priority) wins.
  const contenders = new Set(present.filter((x) => topFit - x.fit <= MARGIN_EPS).map((x) => x.a));
  const winner = ARCHETYPE_PRIORITY.find((a) => contenders.has(a)) ?? sorted[0].a;
  const winnerFit = fits[winner] ?? topFit;

  // Null-when-thin: too few grounded inputs, or the best fit is below the minimal evidence floor.
  const inputCount = presentInputCount(inputs);
  if (inputCount < MIN_INPUTS_PRESENT || topFit < EVIDENCE_FLOOR) {
    return {
      archetype: null,
      confidence: round2(winnerFit),
      margin,
      fits,
      reason: `Thin evidence (${inputCount} inputs, top fit ${round2(topFit)}) — below floor ${EVIDENCE_FLOOR}; unclassified.`,
    };
  }

  const tie = margin <= MARGIN_EPS && present.length > 1;
  return {
    archetype: winner,
    confidence: round2(winnerFit),
    margin,
    fits,
    reason: tie
      ? `${winner} (fit ${round2(winnerFit)}) — priority tie-break over a near-equal fit (margin ${margin}).`
      : `${winner} (fit ${round2(winnerFit)}) — clear winner by ${margin} over the next archetype.`,
  };
}

// ─── Classification metadata (the full breakdown persisted alongside the primary label) ─────────
// The verdict already ranks every archetype and computes the margin, but the persisted feature row historically
// kept ONLY the winning label — so a later study could never ask "what did the misclassified names ALSO look
// like?" or "how close was this call?". This reshapes the verdict into the metadata the feature store persists
// (feature-vector.ts). PURELY DESCRIPTIVE: `primary` is the ONLY field anything downstream partitions on
// (scoring/gating/calibration all key off the single archetype); secondary/scores/margin are captured for
// offline mis/secondary-classification analysis and are never bucketed on. Pure — reads only the verdict.
export interface ArchetypeClassificationMeta {
  /** The winning archetype — authoritative, the ONLY field calibration keys off; null when unclassified. */
  primary: SwingArchetype | null;
  /** Remaining grounded archetypes ranked by fit (desc, priority tie-break), primary excluded; [] when none. */
  secondary: SwingArchetype[];
  /** Per-archetype fit-score map — GROUNDED fits only; an unmeasured archetype is omitted, never a fabricated 0. */
  scores: Record<string, number>;
  /** topFit − runner-up fit — the verdict's already-computed decisiveness margin (small ⇒ a near-tie call). */
  margin: number;
}

/**
 * Derive the full classification metadata from a verdict for persistence. The classifier already did the
 * ranking + margin math; this only RESHAPES it (no re-classification, no new thresholds), so the winner the
 * calibration partitions on can never drift from the secondaries captured beside it. Ranking mirrors the
 * winner's rule — fit desc, ARCHETYPE_PRIORITY (most-specific-first) breaking a fit tie — so the "runner-up"
 * ordering is consistent with how the winner itself was chosen.
 */
export function classificationMetaFromVerdict(v: ArchetypeVerdict): ArchetypeClassificationMeta {
  // Only grounded (non-null) fits are real scores: a null fit means "couldn't measure", NOT a measured 0.
  const ranked = SWING_ARCHETYPES.filter((a) => isNum(v.fits[a])).sort((x, y) => {
    const dy = (v.fits[y] as number) - (v.fits[x] as number);
    if (dy !== 0) return dy;
    // Fit tie → most-specific-first, the same ARCHETYPE_PRIORITY order that breaks the winner's tie above.
    return ARCHETYPE_PRIORITY.indexOf(x) - ARCHETYPE_PRIORITY.indexOf(y);
  });
  const scores: Record<string, number> = {};
  for (const a of ranked) scores[a] = v.fits[a] as number;
  // Secondary = every ranked grounded archetype except the primary winner (when one was assigned).
  const secondary = ranked.filter((a) => a !== v.archetype);
  return { primary: v.archetype, secondary, scores, margin: v.margin };
}

// ─── Adapter: reads → ArchetypeInputs (reuses swing-signals direction-signing) ───
/** Grounded archetype reads that are NOT derivable from SwingReads — supplied pre-normalized (0–1) and, for
 *  the direction-dependent ones, pre-signed by the caller (upstream discovery), same discipline as reads. */
export interface ArchetypeReadExtras {
  nearRangeExtreme01?: number | null;
  breakoutQuality01?: number | null;
  volumeExpansion01?: number | null;
  retraceToSupport01?: number | null;
  oversold01?: number | null;
  reclaim01?: number | null;
  earningsGapRecent01?: number | null;
  postEarningsDrift01?: number | null;
  sectorLeadership01?: number | null;
  catalystInWindow01?: number | null;
}

/**
 * Build ArchetypeInputs from a name's multi-day reads. Reuses `swingSignalsFromReads` for the CANONICAL
 * direction-signing (so trend-stack / rel-strength / accumulation are already aligned to the trade side),
 * then folds in the extra grounded reads that don't live in SwingReads. Anything ungroundable stays null.
 */
export function archetypeInputsFromReads(reads: SwingReads, extras: ArchetypeReadExtras = {}): ArchetypeInputs {
  const s = swingSignalsFromReads(reads);

  const hasStack = s.priceAboveEma20 != null || s.ema20AboveEma50 != null || s.ema50Rising != null;
  const trendStack01 = hasStack ? trendStackScore(s) : null;

  const relStrength01 =
    isNum(s.returnPct10d) && isNum(s.spyReturnPct10d)
      ? relativeStrengthScore(s.returnPct10d, s.spyReturnPct10d)
      : null;

  const accumPersistence01 =
    isNum(s.accumAlignedDays) && isNum(s.accumTotalDays) && s.accumTotalDays > 0
      ? accumulationPersistence(s.accumAlignedDays, s.accumTotalDays)
      : null;

  return {
    direction: s.direction,
    trendStack01,
    relStrength01,
    accumPersistence01,
    nearRangeExtreme01: extras.nearRangeExtreme01 ?? null,
    breakoutQuality01: extras.breakoutQuality01 ?? null,
    volumeExpansion01: extras.volumeExpansion01 ?? null,
    retraceToSupport01: extras.retraceToSupport01 ?? null,
    oversold01: extras.oversold01 ?? null,
    reclaim01: extras.reclaim01 ?? null,
    earningsGapRecent01: extras.earningsGapRecent01 ?? null,
    postEarningsDrift01: extras.postEarningsDrift01 ?? null,
    sectorLeadership01: extras.sectorLeadership01 ?? null,
    catalystInWindow01: extras.catalystInWindow01 ?? null,
  };
}
