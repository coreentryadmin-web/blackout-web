import type { BieAnswerEnvelope, BieEvidence, BieSection } from "@/lib/bie/answer-envelope";

/**
 * SECTION RENDER POLICY — which of the answer's sections become prose cards.
 *
 * THE BUG. The envelope carries all eight contract sections, and the desk-read card rendered every
 * one of them as a prose card — on top of already rendering four of them STRUCTURALLY. Measured
 * against a live answer, the same thesis reached the member up to six times:
 *
 *   Verdict      -> the headline AND a full "Verdict" prose card
 *   Confidence   -> the confidence line AND a "Confidence" card with byte-identical text
 *                   (`confidence.why` IS `get("Confidence")` — the same string, twice)
 *   Risk         -> the "Invalidation" block AND a "Risk" card containing it
 *   Data         -> the source chips AND a "Data" card saying the same freshness in words
 *   Facts        -> the evidence list AND a "Facts" card of RAW markdown, which is where the
 *                   `- [fact]` markers were leaking into the UI: `parseEvidence` strips them,
 *                   the raw section body does not
 *   Bottom line  -> a restatement of Verdict by construction
 *
 * That is not model verbosity — it is the renderer printing the same field twice under two
 * headings. No prompt change could have fixed it, which is why "make the answers shorter" was
 * never going to work.
 *
 * WHAT SURVIVES. Only sections whose content exists NOWHERE else: Interpretation (the reasoning
 * that connects the facts — the one genuinely new prose in the answer) and Conflicts (which
 * systems disagree and why). Everything else is rendered by the component that owns it, once.
 *
 * THIS DELETES NO INFORMATION. Every removed section's content is still on screen — in the
 * headline, the confidence line, the invalidation block, the source chips, or the evidence list.
 * The audit trail moves behind a disclosure rather than disappearing, so a member who wants the
 * full basis still gets every row.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

/**
 * Sections already rendered by a dedicated component. Rendering them again as prose is a literal
 * double-print, not a summary and its detail.
 */
export const STRUCTURALLY_RENDERED = new Set([
  "verdict", // -> envelope.headline
  "confidence", // -> envelope.confidence.level + .why (the identical string)
  "risk", // -> envelope.invalidation
  "data", // -> the source/freshness chips
  "facts", // -> envelope.evidence, parsed and marker-free
]);

/**
 * Sections that restate an earlier one by construction rather than by accident.
 *
 * "Bottom line" is defined in the contract as the takeaway — which is what the Verdict already is.
 * It is dropped from the default view rather than from the contract: Largo may still write it, and
 * it remains in the markdown fallback and the raw envelope for anything that wants it.
 */
export const REDUNDANT_BY_CONSTRUCTION = new Set(["bottom line"]);

/**
 * The sections that earn their own card.
 *
 * Unknown section titles are KEPT. The filter names what is known to be duplicated; anything the
 * contract grows later shows up rather than silently vanishing, which is the safe direction for a
 * renderer to fail in.
 */
export function proseSections(sections: readonly BieSection[] | undefined): BieSection[] {
  return (sections ?? []).filter((s) => {
    const key = String(s?.title ?? "").trim().toLowerCase();
    if (!key) return false;
    if (STRUCTURALLY_RENDERED.has(key)) return false;
    if (REDUNDANT_BY_CONSTRUCTION.has(key)) return false;
    return Boolean(String(s.body ?? "").trim());
  });
}

export type EvidenceSummary = {
  facts: number;
  inferences: number;
  /** Distinct sources, not evidence rows — "6 live sources" answers a different question. */
  sources: number;
  liveSources: number;
  /** Ready-to-render, e.g. "10 facts · 5 inferences · 6 sources". Empty when there is nothing. */
  label: string;
};

/**
 * Summarise the evidence for the collapsed disclosure.
 *
 * Counts what a member would want to know BEFORE deciding to expand: how much basis is there, and
 * how much of it is measurement versus reasoning. Sources are counted DISTINCT — six rows from
 * HELIX is one source, and reporting it as six would inflate the apparent breadth of the answer.
 */
export function summariseEvidence(evidence: readonly BieEvidence[] | undefined): EvidenceSummary {
  const rows = evidence ?? [];
  let facts = 0;
  let inferences = 0;
  const sources = new Map<string, boolean>();

  for (const e of rows) {
    if (e?.kind === "fact" || e?.kind === "calc") facts++;
    else if (e?.kind === "inference" || e?.kind === "scenario") inferences++;
    const src = e?.provenance?.source;
    if (src) sources.set(src, sources.get(src) || e.provenance?.freshness === "live");
  }

  const liveSources = [...sources.values()].filter(Boolean).length;
  const parts: string[] = [];
  if (facts) parts.push(`${facts} ${facts === 1 ? "fact" : "facts"}`);
  if (inferences) parts.push(`${inferences} ${inferences === 1 ? "inference" : "inferences"}`);
  if (sources.size) parts.push(`${sources.size} ${sources.size === 1 ? "source" : "sources"}`);

  return { facts, inferences, sources: sources.size, liveSources, label: parts.join(" · ") };
}

/**
 * Does this answer have enough behind it to be worth expanding?
 *
 * Used to decide whether the disclosure renders at all. An answer with one evidence row does not
 * need a collapsed audit trail — the control would cost more attention than the content.
 */
export function hasExpandableEvidence(envelope: Pick<BieAnswerEnvelope, "evidence">): boolean {
  return (envelope.evidence?.length ?? 0) >= 2;
}
