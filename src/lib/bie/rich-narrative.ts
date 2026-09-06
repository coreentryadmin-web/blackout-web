// Shared rich-narrative helper — the ONE place deterministic BIE composers turn titled prose
// sections into a full BieAnswerEnvelope, so every answer type (concept, data-read, …) is rich and
// CONSISTENT in shape (mirrors how spx-desk-brief.ts builds multi-section THESIS/WHY/MECHANIC/LEVELS
// narrative). A one-liner answer is the thing we're moving away from: prefer several substantive
// sections. Empty/blank sections are dropped so a partially-populated answer stays clean and honest.

import {
  makeEnvelope,
  type BieAnswerEnvelope,
  type BieBias,
  type BieConfidence,
  type BieEvidence,
  type BieLevel,
  type BieScenario,
  type BieSection,
  type BieUnavailableSource,
} from "@/lib/bie/answer-envelope";

export type RichSection = {
  title: string;
  /** Member-readable prose/markdown. Blank → the section is dropped. */
  body: string;
  bias?: BieBias;
};

export type BuildRichEnvelopeInput = {
  headline: string;
  bias?: BieBias;
  intent?: string;
  sections: RichSection[];
  evidence?: BieEvidence[];
  levels?: BieLevel[];
  scenarios?: BieScenario[];
  confidence?: BieConfidence;
  invalidation?: string | null;
  followups?: string[];
  /**
   * Sources requested but unavailable this turn (BIE §4: absence is surfaced, never silently
   * dropped). `BieAnswerEnvelope` has carried this field since the envelope contract shipped, but
   * this builder never forwarded it to `makeEnvelope` — every rich composer routed through here
   * (concept answers, the swing play brief) silently lost the field even when its own upstream
   * context had one to report. `BieAnswer.tsx` already renders it via `UnavailableChip`; this is
   * the missing wire, not a new UI concept.
   */
  unavailableSources?: BieUnavailableSource[];
};

/**
 * Assemble a rich multi-section envelope from titled prose. The single constructor every rich
 * deterministic composer should call — keeps headline/sections/evidence/levels/scenarios/confidence
 * uniform and produces the backward-compatible `markdown` for the existing string Largo path.
 */
export function buildRichEnvelope(input: BuildRichEnvelopeInput): BieAnswerEnvelope {
  const sections: BieSection[] = input.sections
    .filter((s) => s.body && s.body.trim().length > 0)
    .map((s) => ({ title: s.title, body: s.body.trim(), ...(s.bias ? { bias: s.bias } : {}) }));

  return makeEnvelope({
    headline: input.headline,
    bias: input.bias ?? "neutral",
    intent: input.intent ?? null,
    sections,
    evidence: input.evidence ?? [],
    levels: input.levels,
    scenarios: input.scenarios,
    // Largo C6: omit confidence when the composer has no calibrated score — never fabricate.
    ...(input.confidence ? { confidence: input.confidence } : {}),
    invalidation: input.invalidation ?? null,
    followups: input.followups,
    unavailableSources: input.unavailableSources,
  });
}
