// src/lib/swing/dossier.ts — THE one versioned SwingDossier carrier (PR-3, resolves SEV-2).
//
// A swing thesis is carried by ONE object from produce → score → gate → manage → grade → calibrate. Every
// consumer takes this shape; nobody re-derives its parts, so the archetype the scorer weighted is the SAME
// archetype the grader partitions on (SEV-2: the five drafts each carried their own ad-hoc bag → the score
// and the grade could disagree about what a name even was). `buildSwingDossier` composes the already-shipped
// pure cores — `archetypeInputsFromReads`+`classifyArchetype` (the label), the grounded pillar helpers +
// `scoreSwingPillars` (the evidence score), `subLaneForDte` (the contract class) — into that single carrier.
//
// NULL-HONESTY (the repo's standing law): every pillar is `numOrNull` — a missing feed stays null, NEVER a
// fabricated 0, and is counted in `dataQuality.missing`. `dataQuality.degraded` flags a read too thin to
// trust (few pillars, or the structural backbone absent) so downstream gates can fail honest instead of
// acting on a hollow score. Versioned (`v`) so old carriers stay interpretable as the schema evolves.
//
// PURE & deterministic — no IO. Evidence-only: the score/label surface on the desk; nothing here sizes risk.

import type { SwingReads } from "../swing-signals";
import { swingSignalsFromReads } from "../swing-signals";
import type { PlayDirection } from "../horizon-fanout";
import type { SwingSubLane } from "./taxonomy";
import { subLaneForDte } from "./taxonomy";
import { SWING_PILLARS, type SwingPillar } from "./swing-archetype";
import {
  scoreSwingPillars,
  structureSignal,
  relStrengthSignal,
  flowSignal,
  volatilitySignal,
  catalystSignal,
  type SwingPillarSignals,
  type SwingPillarScore,
} from "./swing-pillars";
import {
  classifyArchetype,
  archetypeInputsFromReads,
  type ArchetypeVerdict,
  type ArchetypeReadExtras,
} from "./archetype";

/** Bump when the carrier's shape changes so old graded/persisted dossiers stay interpretable. */
export const SWING_DOSSIER_VERSION = 1;

/** Below this present-pillar count the score is too thin to trust → degraded. */
const MIN_PRESENT_PILLARS = 3;
/** The structural backbone — its absence degrades the read regardless of the raw count. */
const CRITICAL_PILLAR: SwingPillar = "STRUCTURE";

const numOrNull = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? n : null;

export interface SwingDataQuality {
  /** True when the read is too thin to trust (too few pillars, or the critical pillar is missing). */
  degraded: boolean;
  /** How many of the 7 pillars were grounded. */
  presentPillars: number;
  /** The pillar names that were absent (a null feed is listed here, never silently read as 0). */
  missing: string[];
}

/** The single carrier — identity + the classified label + the pillar evidence + the resolved contract lane. */
export interface SwingDossier {
  /** Schema version. */
  v: number;
  ticker: string;
  /** Resolved trade direction (from swing-signals), or null when the name isn't a directional swing. */
  direction: PlayDirection | null;
  /** ISO timestamp of the read. */
  asOf: string;
  archetype: ArchetypeVerdict;
  pillarSignals: SwingPillarSignals;
  /** The evidence score computed over the present pillars, weighted by the winning archetype. */
  score: SwingPillarScore;
  /** The contract sub-lane owning the intended DTE, or null when no DTE / outside [2,30]. */
  subLane: SwingSubLane | null;
  dataQuality: SwingDataQuality;
}

/** Grounded pillar-helper inputs. Each cluster is optional; an absent cluster → that pillar is null (absent),
 *  never 0. The direction-dependent fields inside are pre-signed upstream, same as `reads`. */
export interface SwingDossierInput {
  ticker: string;
  /** Read timestamp; defaults to now. */
  asOf?: string | number | Date;
  /** The DTE the thesis intends to trade — resolves the sub-lane (drives Pillar D/E lane-sensitivity). */
  intendedDte?: number | null;
  /** Multi-day reads → direction-signing + the derived structure/rel-strength/flow/accumulation signals. */
  reads: SwingReads;
  /** Extra grounded archetype reads not derivable from `reads` (breakout/oversold/reclaim/catalyst/…). */
  archetypeExtras?: ArchetypeReadExtras;
  // ── pillar-helper inputs (absent cluster ⇒ that pillar null) ──
  structure?: Parameters<typeof structureSignal>[0];
  relStrength?: Parameters<typeof relStrengthSignal>[0];
  flow?: Parameters<typeof flowSignal>[0];
  volatility?: Parameters<typeof volatilitySignal>[0];
  catalyst?: Parameters<typeof catalystSignal>[0];
  /** Pre-normalized broad-market regime read (0–1), or null when absent. */
  regime01?: number | null;
  /** Pre-normalized data-quality/agreement read (0–1), or null when absent. */
  dataQuality01?: number | null;
}

function toIso(asOf: SwingDossierInput["asOf"]): string {
  if (asOf == null) return new Date().toISOString();
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Compose the one dossier: classify the archetype (reusing swing-signals direction-signing), populate the
 * 7 pillar sub-scores from the grounded helpers, score them through the winning archetype's weights, resolve
 * the sub-lane, and tally data quality. Nulls are preserved end-to-end (a missing feed stays null).
 */
export function buildSwingDossier(input: SwingDossierInput): SwingDossier {
  const subLane = input.intendedDte != null ? subLaneForDte(input.intendedDte) : null;

  const archInputs = archetypeInputsFromReads(input.reads, input.archetypeExtras);
  const archetype = classifyArchetype(archInputs);
  const direction = swingSignalsFromReads(input.reads).direction;

  // Each pillar: run its grounded helper when the cluster is present, else null (absent → dropped, not 0).
  const pillarSignals: SwingPillarSignals = {
    STRUCTURE: input.structure ? structureSignal(input.structure) : null,
    REL_STRENGTH: input.relStrength ? relStrengthSignal(input.relStrength) : null,
    FLOW: input.flow ? flowSignal(input.flow) : null,
    VOLATILITY: input.volatility ? volatilitySignal(input.volatility, subLane) : null,
    CATALYST: input.catalyst ? catalystSignal(input.catalyst, subLane) : null,
    REGIME: numOrNull(input.regime01),
    DATA_QUALITY: numOrNull(input.dataQuality01),
  };

  const score = scoreSwingPillars(pillarSignals, archetype.archetype, subLane);

  const missing = SWING_PILLARS.filter((p) => numOrNull(pillarSignals[p]) == null);
  const presentPillars = SWING_PILLARS.length - missing.length;
  const degraded = presentPillars < MIN_PRESENT_PILLARS || missing.includes(CRITICAL_PILLAR);

  return {
    v: SWING_DOSSIER_VERSION,
    ticker: input.ticker,
    direction,
    asOf: toIso(input.asOf),
    archetype,
    pillarSignals,
    score,
    subLane,
    dataQuality: { degraded, presentPillars, missing },
  };
}
