// src/lib/swing/swing-pillars.ts — the 7-pillar SWING evidence scorer (skeleton for PR-2).
//
// The score is NOT the 0DTE flow score (failure mode #1). It weighs seven independent pillars
// (structure / relative strength / flow / volatility / catalyst / regime / data-quality) through the
// ACTIVE ARCHETYPE'S weight vector (swing-archetype.ts). Each pillar arrives as a 0–1 sub-score computed
// upstream from real reads (PR-3 dossier feeds them; the grounded helpers below reuse the horizon
// normalizers so the mappings are shared, not re-invented). A pillar with no data is ABSENT (null) and is
// DROPPED FROM THE DENOMINATOR — the remaining present weights renormalize to 100, so a name never scores
// low merely because one feed was missing (that honesty is carried by the DATA_QUALITY pillar + the gate
// stack, not by silently penalizing absence).
//
// PURE & deterministic. Score ∈ [0,100]. Evidence-only: this number surfaces on the desk and feeds the
// COMMIT/WATCH floor comparison, but the floor itself is provisional (taxonomy) — nothing here sizes risk.

import type { SwingArchetype, SwingSubLane } from "./taxonomy";
import { SWING_SUB_LANES } from "./taxonomy";
import {
  SWING_PILLARS,
  weightsForArchetype,
  type SwingPillar,
} from "./swing-archetype";
import {
  accumulationPersistence,
  relativeStrengthScore,
  trendStackScore,
} from "../horizon-scorers";

/** A 0–1 sub-score per pillar; a pillar OMITTED or null is treated as ABSENT (no data). */
export type SwingPillarSignals = Partial<Record<SwingPillar, number | null>>;

export interface SwingPillarContribution {
  pillar: SwingPillar;
  present: boolean;
  /** The raw 0–1 sub-score (null when absent). */
  raw: number | null;
  /** The pillar's nominal weight for the active archetype (before renormalization). */
  weight: number;
  /** Points actually contributed = raw × renormalized weight (0 when absent). */
  points: number;
}

export interface SwingPillarScore {
  /** 0–100 evidence score over the PRESENT pillars (renormalized). */
  score: number;
  archetype: SwingArchetype | null;
  subLane: SwingSubLane | null;
  contributions: SwingPillarContribution[];
  /** Present-pillar count — surfaced so the desk/gate can flag a thin (few-pillar) read. */
  presentCount: number;
  reason: string;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;
const isPresent = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/**
 * Weigh the pillar sub-scores through the archetype's vector, renormalizing over PRESENT pillars.
 *
 * effectiveWeight_i = weight_i × (100 / Σ present weights);  points_i = raw_i × effectiveWeight_i.
 * With every pillar present this is the plain weighted sum; with pillars absent the denominator shrinks so
 * the surviving pillars still span [0,100]. Returns score 0 with no present pillar (honest floor, not NaN).
 */
export function scoreSwingPillars(
  signals: SwingPillarSignals,
  archetype: SwingArchetype | null,
  subLane: SwingSubLane | null = null,
): SwingPillarScore {
  const weights = weightsForArchetype(archetype);

  const presentWeightSum = SWING_PILLARS.reduce(
    (n, p) => (isPresent(signals[p]) ? n + weights[p] : n),
    0,
  );
  const renorm = presentWeightSum > 0 ? 100 / presentWeightSum : 0;

  const contributions: SwingPillarContribution[] = SWING_PILLARS.map((pillar) => {
    const raw = signals[pillar];
    const present = isPresent(raw);
    const weight = weights[pillar];
    const points = present ? clamp01(raw) * weight * renorm : 0;
    return { pillar, present, raw: present ? clamp01(raw) : null, weight, points: round1(points) };
  });

  const score = round1(contributions.reduce((n, c) => n + c.points, 0));
  const presentCount = contributions.filter((c) => c.present).length;

  const top = [...contributions].filter((c) => c.present).sort((a, b) => b.points - a.points)[0];
  const reason =
    presentCount === 0
      ? "No pillar data — unscorable (evidence absent)."
      : `${archetype ?? "unclassified"} · ${presentCount}/7 pillars · led by ${top?.pillar ?? "?"} (${top?.points ?? 0}pt).`;

  return {
    score: Math.max(0, Math.min(100, score)),
    archetype,
    subLane,
    contributions,
    presentCount,
    reason,
  };
}

// ── grounded pillar sub-score helpers (reuse the shared horizon normalizers) ───────────
// PR-3's dossier builder calls these so the raw→0–1 mappings live in ONE place. Each returns null when its
// primary signal is absent, so the pillar drops from the scorer's denominator rather than reading as 0.

/** STRUCTURE (A): the daily EMA trend-stack (price>EMA20>EMA50, EMA50 rising), optionally blended with a
 *  pre-normalized breakout/volume-confirmation read. Null when no structure signal is present. */
export function structureSignal(input: {
  priceAboveEma20?: boolean;
  ema20AboveEma50?: boolean;
  ema50Rising?: boolean;
  breakoutQuality01?: number | null;
  volumeConfirm01?: number | null;
}): number | null {
  const parts: number[] = [];
  const hasStack =
    input.priceAboveEma20 != null || input.ema20AboveEma50 != null || input.ema50Rising != null;
  if (hasStack) parts.push(trendStackScore(input));
  if (isPresent(input.breakoutQuality01)) parts.push(clamp01(input.breakoutQuality01));
  if (isPresent(input.volumeConfirm01)) parts.push(clamp01(input.volumeConfirm01));
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
}

/** REL_STRENGTH (B): outperformance vs SPY over the lookback, optionally blended with a sector-rank read.
 *  Null when neither is present. */
export function relStrengthSignal(input: {
  nameReturnPct?: number | null;
  spyReturnPct?: number | null;
  sectorRank01?: number | null;
}): number | null {
  const parts: number[] = [];
  if (isPresent(input.nameReturnPct) && isPresent(input.spyReturnPct)) {
    parts.push(relativeStrengthScore(input.nameReturnPct, input.spyReturnPct));
  }
  if (isPresent(input.sectorRank01)) parts.push(clamp01(input.sectorRank01));
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
}

/** FLOW (C): multi-day accumulation persistence (aligned/total sessions), optionally blended with
 *  aggression / strike-concentration reads. Null when no flow evidence is present. */
export function flowSignal(input: {
  accumAlignedDays?: number | null;
  accumTotalDays?: number | null;
  aggression01?: number | null;
  strikeConcentration01?: number | null;
}): number | null {
  const parts: number[] = [];
  if (isPresent(input.accumAlignedDays) && isPresent(input.accumTotalDays) && input.accumTotalDays > 0) {
    parts.push(accumulationPersistence(input.accumAlignedDays, input.accumTotalDays));
  }
  if (isPresent(input.aggression01)) parts.push(clamp01(input.aggression01));
  if (isPresent(input.strikeConcentration01)) parts.push(clamp01(input.strikeConcentration01));
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
}

/** VOLATILITY (D): a pre-normalized contract-quality read (IV-percentile / term / expected-move / option
 *  liquidity), reduced by the sub-lane's theta burden — Tactical (thetaSensitivity 1.0) is penalised
 *  hardest for a costly theta profile, Extended (0.3) least. Null when no vol read is present. */
export function volatilitySignal(
  input: { contractQuality01?: number | null; thetaBurden01?: number | null },
  subLane: SwingSubLane | null,
): number | null {
  if (!isPresent(input.contractQuality01)) return null;
  let s = clamp01(input.contractQuality01);
  if (isPresent(input.thetaBurden01) && subLane != null) {
    const sens = SWING_SUB_LANES[subLane].thetaSensitivity;
    s = clamp01(s - clamp01(input.thetaBurden01) * sens * 0.5); // theta burden erodes up to half the read on Tactical
  }
  return s;
}

/** CATALYST (E): a pre-normalized catalyst-strength read; an earnings/binary event INSIDE the holding
 *  window is a HAZARD (a gap can nuke a directional swing), scaled by the sub-lane's earningsHazard. Null
 *  when no catalyst read is present. */
export function catalystSignal(
  input: { catalystStrength01?: number | null; earningsInWindow?: boolean },
  subLane: SwingSubLane | null,
): number | null {
  if (!isPresent(input.catalystStrength01)) return null;
  let s = clamp01(input.catalystStrength01);
  if (input.earningsInWindow && subLane != null) {
    s = clamp01(s - SWING_SUB_LANES[subLane].earningsHazard * 0.5);
  }
  return s;
}
