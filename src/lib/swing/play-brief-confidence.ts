import type { BieConfidence, BieUnavailableSource } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";

/**
 * Swing play-brief `confidence` (Largo C6) — how much real evidence grounds THIS read, never a
 * directional win-probability or thesis-health score.
 *
 * WHY A SEPARATE FUNCTION, AND WHY NOT `computeSwingThesisHealth`'s % (Ask Largo standing mandate,
 * operator directive 2026-09-26, following up on the enhancement idea raised as PR #4076 comment
 * 5849016880): `BieConfidence` has an established, load-bearing semantic elsewhere in this codebase
 * — `verdict-core.ts`'s `assembleVerdictEnvelope` calibrates it from EVIDENCE COVERAGE ("Multiple
 * engines agree (N live surfaces)..."), and `cortex-read.ts`'s `buildPinnedCortexEnvelope` calibrates
 * it from RECORD SOLIDITY ("Pinned commit-time evidence from the ledger — the WHY of record" = high;
 * "no Cortex verdict pinned" = moderate; "every source absent" = insufficient). Neither ever answers
 * "how likely is this trade to win" — that would be exactly the C6 violation the contract document
 * itself warns about ("An invented score is compared against another lane's measured one... omission
 * is honest; fabrication is not"). `computeSwingThesisHealth`'s percentage answers a DIFFERENT
 * question — "is the original thesis still intact" (a directional-health read) — not "how much
 * evidence do we actually have for this specific answer." Conflating the two under one label would
 * itself be a C6 violation, not a fix for one. This function instead answers the SAME question the
 * two established precedents already answer, using ONLY already-computed, already-thresholded swing
 * fields — it introduces zero new numeric thresholds.
 *
 * THE THREE INPUTS, ALL PRE-EXISTING:
 *   1. `bucket === "closed"` — a closed play's outcome IS the ledger record (real P&L, not a
 *      re-derived live read), mirroring cortex-read.ts's exact "pinned record" reasoning. Checked
 *      FIRST: even a play whose ENTRY evidence was thin (see #2) still has a solid, known OUTCOME
 *      once closed — the record's own solidity dominates, exactly as it does for an "abstained"
 *      Cortex verdict (worse entry signal, still a real, citable record).
 *   2. `play.entryPresentPillars` — ALREADY a production field (`live-plays.ts`'s
 *      `entryPresentPillarsFromFeatureVector`, read back from `feature_vector` pinned at commit),
 *      ALREADY gated on dossier.ts's existing `MIN_PRESENT_PILLARS`/`CRITICAL_PILLAR` degraded
 *      threshold, and ALREADY rendered to members verbatim as "Evidence at entry: thin read — N/7
 *      pillars grounded" (play-brief-intel.ts). Non-null means THAT existing gate already flagged
 *      this specific play's entry evidence as thin — reused here, not re-derived.
 *   3. `unavailableSources.length` — the SAME array `collectBriefUnavailableSources(ctx)` already
 *      builds for the envelope's own `unavailableSources` chips (Largo C3). Zero vs non-zero is the
 *      least arbitrary possible split (existence, not a tuned count) — mirrors verdict-core.ts's own
 *      `substantive >= 1` floor, which is likewise a presence check, not a magnitude tune.
 *
 * NEVER READS: `computeSwingThesisHealth`'s pillar deltas, `thesisLevel`, `score`, `direction`, any
 * exit-policy/stop/target field — this function cannot influence trade selection, direction, entry,
 * stop, target, or `liveStatus`; it only shapes one additional, purely-informational envelope field.
 */
export function swingPlayBriefConfidence(
  play: TerminalPlay,
  bucket: "watch" | "open" | "closed",
  unavailableSources: readonly BieUnavailableSource[]
): BieConfidence {
  if (bucket === "closed") {
    return {
      level: "high",
      why: "Closed play — the outcome is the ledger record, not a re-derived live read.",
    };
  }

  const entryPillars = play.entryPresentPillars;
  if (entryPillars != null) {
    return {
      level: "low",
      why: `Entry evidence was thin — only ${entryPillars}/7 pillars grounded at commit (see "Evidence at entry" above).`,
    };
  }

  if (unavailableSources.length === 0) {
    return {
      level: "high",
      why: "Every live source this brief reads from resolved cleanly this cycle.",
    };
  }

  return {
    level: "moderate",
    why: `${unavailableSources.length} source${unavailableSources.length === 1 ? "" : "s"} unavailable this cycle — see Data freshness.`,
  };
}
