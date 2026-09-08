/**
 * Trim swing play-brief envelope for the Night Hawk center rail — the deck header,
 * action strip, and right thesis panel already surface verdict/grade/confidence.
 */
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

const DECK_OMIT_SECTIONS = new Set([
  "Verdict",
  "Management",
  "Thesis health",
  "Position",
]);

/** Strip chrome duplicated by SwingLargoInsightsPanel + PlayTerminal. */
export function envelopeForSwingDeckBrief(envelope: BieAnswerEnvelope): BieAnswerEnvelope {
  return {
    ...envelope,
    headline: "",
    confidence: undefined,
    sections: envelope.sections.filter((s) => !DECK_OMIT_SECTIONS.has(s.title)),
  };
}
