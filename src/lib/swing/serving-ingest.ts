// src/lib/swing/serving-ingest.ts — the per-ticker SERVING META builder (PR-12). Pure, no IO.
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-12): the serving BOARD (serving-board.ts) groups plays into the
// seven sections, but each row on the desk also carries a small bundle of member-facing reads — the
// factors that built the score, the regime it sits in, the thesis-health level, and the (still-null)
// calibrated surfaces. This module distills ONE `SwingDossier` (± grounded price-vs-level reads) into that
// bundle, so the command-deck adapter renders REAL evidence instead of the hardcoded `[]`/`null`/`intact`
// placeholders it shipped with (adapters.ts:163). It is the "real reads" half of the de-hardcode.
//
// EVIDENCE-ONLY / MEMBER-SAFE (the standing law): every field is grounded or honestly null. `factors` are
// the dossier's ACTUAL pillar contributions (never invented). `thesisLevel` degrades to "unknown" when no
// setup read exists — a data-absent thesis is NEVER painted "intact" (mirrors the 0DTE adapter's 9-6c
// stance). `calibratedProbability`/`expectedValue` are held at LITERAL null: nothing in the swing lane has
// graduated a calibrated bucket yet (PR-16), so the desk shows "—", not a fabricated edge. NULL-not-zero
// throughout: a missing feed is null, never a 0.
//
// PURE & deterministic — reads are injected; the clock is never touched here.

import type { SwingDossier } from "./dossier";
import type {
  SwingArchetype,
  SwingEntryState,
  SwingSetupState,
  SwingSubLane,
} from "./taxonomy";
import { ARCHETYPE_META } from "./taxonomy";
import type { SwingThesisLevel } from "./serving";
import { deriveSetupState, type SetupStateReads } from "./setup-state";
import { deriveEntryPlan, type EntryReads } from "./entry-model";
import type { ChainContract } from "../horizon-fanout";
import type { SwingPillar } from "./swing-archetype";

/** A signed, point-weighted factor — structurally the command-deck's DeckFactor, kept lib-local so this
 *  pure module never imports the features layer (the adapter reads this shape via HorizonDeckSource). */
export interface SwingServingFactor {
  label: string;
  points: number;
}

/** Human labels for the 7 pillars — the factor rows the desk renders (biggest lever first). */
const PILLAR_LABELS: Record<SwingPillar, string> = {
  STRUCTURE: "Structure",
  REL_STRENGTH: "Rel. strength",
  FLOW: "Flow",
  VOLATILITY: "Volatility",
  CATALYST: "Catalyst",
  REGIME: "Regime",
  DATA_QUALITY: "Data quality",
};

/** The per-ticker serving meta a swing row carries — the real reads behind the desk's thesis panel. */
export interface SwingServingMeta {
  ticker: string;
  /** Pre-entry setup maturity (setup-state.ts) — null when no grounded price-vs-level read was supplied. */
  setupState: SwingSetupState | null;
  /** Entry-execution stance (entry-model.ts) — null when no grounded entry read/contract was supplied. */
  entryStatus: SwingEntryState | null;
  /** The classified archetype (the calibration partition key), or null when unclassifiable. */
  archetype: SwingArchetype | null;
  /** Human archetype label for the desk. */
  archetypeLabel: string | null;
  /** The resolved contract sub-lane, or null when no DTE / outside [2,30]. */
  subLane: SwingSubLane | null;
  /** The dossier's ACTUAL pillar contributions (present pillars only), biggest lever first. */
  factors: SwingServingFactor[];
  /** Regime read: the archetype label blended with the normalized regime pillar, or null when absent. */
  regime: string | null;
  /** Thesis-health level — "unknown" when data-absent (NEVER a fabricated "intact"). */
  thesisLevel: SwingThesisLevel;
  /** Short human note explaining the thesis level, when there is something to say. */
  thesisNote: string | null;
  /** LITERAL null in PR-12: no swing bucket has graduated a calibrated probability yet (PR-16). */
  calibratedProbability: number | null;
  /** LITERAL null in PR-12: no graded EV surface until the ladder graduates the bucket. */
  expectedValue: number | null;
}

/** Grounded reads that let the meta place a name on the maturity/entry line. All optional — absent ⇒ the
 *  corresponding observable stays null and the row degrades honestly (RESEARCH/WATCH), never a guess. */
export interface SwingServingReads {
  setup?: SetupStateReads;
  entry?: EntryReads;
  /** The concrete contract the entry plan is scoped to (entry-model needs it for the validity deadline). */
  contract?: ChainContract;
  asOf?: string | number | Date;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Build the deck-ready thesis-break object from the meta — the exact `{ level, note? }` shape the
 * command-deck's TerminalPlay.thesisBreak renders. Kept here so the derivation (data-absent ⇒ "unknown")
 * lives with the rest of the honesty rules, not duplicated in the adapter.
 */
export function thesisBreakFromMeta(meta: SwingServingMeta): { level: SwingThesisLevel; note?: string } {
  return meta.thesisNote != null ? { level: meta.thesisLevel, note: meta.thesisNote } : { level: meta.thesisLevel };
}

/**
 * Distill one dossier (± grounded reads) into the per-ticker serving meta. Factors come straight from the
 * dossier's scored pillar contributions; the regime blends the archetype label with the regime pillar; the
 * thesis level is derived from setup maturity + data-quality with the data-absent → "unknown" honesty rule.
 */
export function swingServingMetaFromDossier(
  dossier: SwingDossier,
  reads?: SwingServingReads,
): SwingServingMeta {
  const archetype = dossier.archetype.archetype;
  const archetypeLabel = archetype ? ARCHETYPE_META[archetype].label : null;

  // ── setup maturity + entry stance (only when the grounded reads are supplied) ──
  const setupState = reads?.setup ? deriveSetupState(dossier, reads.setup) : null;
  const entryStatus =
    reads?.entry && reads?.contract
      ? deriveEntryPlan(dossier, reads.contract, reads.entry, reads.asOf).entryState
      : null;

  // ── factors: the dossier's real, present-pillar contributions, biggest lever first ──
  const factors: SwingServingFactor[] = dossier.score.contributions
    .filter((c) => c.present && c.points > 0)
    .map((c) => ({ label: PILLAR_LABELS[c.pillar], points: round1(c.points) }))
    .sort((a, b) => b.points - a.points);

  // ── regime: archetype label blended with the normalized regime pillar read (null when neither exists) ──
  const regime01 = dossier.pillarSignals.REGIME;
  const regimePart = regime01 != null && Number.isFinite(regime01) ? `regime ${regime01.toFixed(2)}` : null;
  const regime = archetypeLabel
    ? regimePart
      ? `${archetypeLabel} · ${regimePart}`
      : archetypeLabel
    : regimePart;

  // ── thesis level: broken > thin (degraded) > intact > unknown. A data-absent thesis is UNKNOWN, never
  //    a fabricated "intact" (9-6c honesty) — the desk shows amber "unknown", not a false green. ──
  let thesisLevel: SwingThesisLevel;
  let thesisNote: string | null;
  if (setupState === "INVALIDATED") {
    thesisLevel = "break";
    thesisNote = "structure invalidated — thesis broke pre-entry";
  } else if (dossier.dataQuality.degraded) {
    thesisLevel = "warn";
    thesisNote = `thin read — ${dossier.dataQuality.presentPillars}/7 pillars grounded`;
  } else if (setupState != null) {
    thesisLevel = "intact";
    thesisNote = null;
  } else {
    thesisLevel = "unknown";
    thesisNote = "no setup read attached to this name yet";
  }

  return {
    ticker: dossier.ticker.toUpperCase(),
    setupState,
    entryStatus,
    archetype,
    archetypeLabel,
    subLane: dossier.subLane,
    factors,
    regime,
    thesisLevel,
    thesisNote,
    // Calibration-first: nothing has graduated a calibrated bucket in the swing lane, so these stay null
    // (the desk renders "—"). PR-16 lights them up once an archetype×sub-lane bucket clears the ladder.
    calibratedProbability: null,
    expectedValue: null,
  };
}
