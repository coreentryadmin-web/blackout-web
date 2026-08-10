/**
 * SELF-CONTRADICTION CHECK — does the Verdict agree with the answer's own Facts?
 *
 * MEASURED LIVE 2026-08-10. Asked which open plays would break first if VIX doubled, Largo wrote:
 *
 *   **Verdict**  "There are no open plays right now… A VIX doubling would have nothing to break
 *                 because nothing is live."
 *   **Facts**    "Bangers (Engine B): 20 open positions (JMIA, BHC, HLF…)"
 *                "Swings lane: 13 committed, 7 watch"
 *
 * The verdict says zero. Its own facts, four lines below, say thirty-three. It had silently
 * narrowed "open plays" to mean 0DTE while answering a question about all live risk.
 *
 * WHY NOTHING ELSE CATCHES THIS. Every existing check passes on that answer. The numbers are real
 * and traceable, so `verifyClaims` is satisfied. The sections are present, so the answer contract
 * conforms. The timeframe is right, so the plan validator is silent. Grounding is 1.0. Nothing in
 * the system compares the answer's CONCLUSION against the answer's own EVIDENCE — and a confident
 * "nothing is live" is exactly the sentence a member acts on without reading further.
 *
 * DELIBERATELY NARROW. This detects ONE shape: the verdict asserts absence, the facts enumerate
 * presence. It does not attempt general contradiction detection, which needs semantics this cannot
 * have and would fire constantly on hedged language ("mostly quiet, though NVDA is active" is not
 * a contradiction). A checker that cries wolf gets deleted; a checker that catches one real,
 * recurring, high-consequence shape gets kept.
 *
 * It appends a caveat and never suppresses. The answer around the contradiction may be entirely
 * useful, and the member is better served by "these two parts disagree" than by silence or by a
 * deleted answer.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

import { parseAnswerEnvelope } from "@/lib/largo/answer-contract";

/** Phrases that assert nothing exists. Anchored to a countable noun by the caller. */
const ABSENCE_RE =
  /\b(?:no|zero|none|not any|nothing|aren'?t any|are no|have no|has no|there (?:are|is) no)\b/i;

/**
 * Concept groups, not bare nouns.
 *
 * The live case would have slipped through a noun-for-noun match: the verdict said "no open
 * PLAYS" while the evidence reported "20 open POSITIONS" — one concept, two words, and a checker
 * requiring the same token sees no contradiction. Members and the model both use these
 * interchangeably, so they are grouped.
 *
 * Kept small and concrete. Every entry names something the platform actually enumerates with a
 * count; a general noun list would match prose and produce noise.
 */
const CONCEPTS: ReadonlyArray<{ label: string; nouns: readonly string[] }> = [
  {
    label: "live risk",
    nouns: ["open plays", "open positions", "live plays", "committed", "plays", "positions"],
  },
  { label: "trades", nouns: ["trades", "fills"] },
  { label: "alerts", nouns: ["alerts", "signals", "prints"] },
];

export type Contradiction = {
  noun: string;
  /** The verdict sentence asserting absence. */
  claim: string;
  /** The fact line that contradicts it, and the count it carries. */
  evidence: string;
  count: number;
};

function sectionText(markdown: string, names: readonly string[]): string {
  const env = parseAnswerEnvelope(markdown);
  if (!env) return "";
  const parts: string[] = [];
  for (const s of env.sections ?? []) {
    if (names.some((n) => s.title?.toLowerCase().includes(n))) parts.push(s.body ?? "");
  }
  return parts.join("\n");
}

/**
 * Find verdict-vs-facts contradictions of the absence/presence shape.
 *
 * Requires BOTH halves to be explicit: an absence phrase within a short window of the noun in the
 * verdict, AND a positive integer immediately before the same noun in the evidence. Requiring the
 * number to be adjacent to the noun is what keeps "20 minutes ago… no open plays" from matching.
 */
export function findContradictions(markdown: string): Contradiction[] {
  const verdict = sectionText(markdown, ["verdict"]);
  const evidence = sectionText(markdown, ["facts", "data", "evidence"]);
  if (!verdict || !evidence) return [];

  for (const concept of CONCEPTS) {
    // Absence asserted about ANY noun in the concept, within ~40 chars so an unrelated "no"
    // elsewhere in a long verdict cannot pair with a noun it was never about.
    let claim: string | null = null;
    for (const noun of concept.nouns) {
      const near = new RegExp(`${ABSENCE_RE.source}[^.]{0,40}?\\b${noun}\\b`, "i");
      const m = verdict.match(near);
      if (m) {
        claim = m[0].trim();
        break;
      }
    }
    if (!claim) continue;

    // A positive count immediately before ANY noun in the same concept. Adjacency is what keeps
    // "refreshed 20 minutes ago … 0 open plays" from matching.
    for (const noun of concept.nouns) {
      const counted = new RegExp(`\\b(\\d{1,4})\\s+${noun}\\b`, "i");
      const m = evidence.match(counted);
      if (!m) continue;
      const count = Number(m[1]);
      if (!Number.isFinite(count) || count <= 0) continue;
      // One report per answer: listing every synonym would read as several separate problems.
      return [{ noun: concept.label, claim, evidence: m[0].trim(), count }];
    }
  }
  return [];
}

/**
 * Append the contradiction as a caveat.
 *
 * Named plainly. "These two parts of the answer disagree" is something a member can act on; a
 * softened "some figures may vary" is not.
 */
export function applyCoherenceCaveat(text: string, found: readonly Contradiction[]): string {
  if (found.length === 0) return text;
  const c = found[0]!;
  return (
    `${text}\n\n> **These two parts of this answer disagree.** The verdict says "${c.claim}", ` +
    `but the evidence below it reports "${c.evidence}". Trust the evidence and treat the verdict ` +
    `as scoped more narrowly than the question.`
  );
}


/**
 * IMPOSSIBLE PROVENANCE — a platform-owned number attributed to a market-data vendor.
 *
 * MEASURED LIVE 2026-08-10. Asked which engine had the worst win rate, Largo answered correctly
 * and stamped it:
 *
 *   [fact] 0DTE Command: 123 graded plays over 30 days, 34.7% win rate (Polygon · … · live)
 *
 * Polygon is a market-data vendor. It does not know which trades BlackOut recommended, and it
 * certainly does not know how they were graded — that number comes from our own Postgres ledger
 * and nowhere else. The figure was right; the attribution was impossible.
 *
 * WHY THIS MATTERS MORE THAN A COSMETIC SLIP. The provenance stamp is the thing the product tells
 * members to trust when judging a number. A stamp that names a plausible-sounding external vendor
 * makes an internal number look independently verified. That is strictly worse than no stamp: it
 * manufactures confidence rather than merely failing to supply it.
 *
 * DECIDABLE, WHICH IS WHY IT IS CHECKED HERE. This needs no semantics — it is a closed question.
 * A vendor either can or cannot know a given class of fact, and for our own trade outcomes the
 * answer is always no.
 */
const PLATFORM_OWNED_RE =
  /\b(win ?rate|graded plays?|graded|track record|our (?:record|trades|plays)|p&l|pnl|committed plays?|scan rejections?|cortex|governor)\b/i;

/** External market-data vendors. They price instruments; they do not grade our trades. */
const EXTERNAL_SOURCE_RE = /\b(polygon|unusual ?whales|uw|benzinga|massive)\b/i;

export type ProvenanceLie = { line: string; source: string };

/**
 * Facts whose stamp names a vendor that cannot possibly know the claim.
 *
 * Scans the evidence sections line by line, because provenance is per-fact. Only fires when BOTH
 * a platform-owned metric AND an external vendor appear on the SAME line — a paragraph mentioning
 * Polygon elsewhere is not evidence of a mis-stamp.
 */
export function findProvenanceLies(markdown: string): ProvenanceLie[] {
  const evidence = sectionText(markdown, ["facts", "data", "evidence"]);
  if (!evidence) return [];
  const out: ProvenanceLie[] = [];
  for (const line of evidence.split("\n")) {
    if (!PLATFORM_OWNED_RE.test(line)) continue;
    const m = line.match(EXTERNAL_SOURCE_RE);
    if (!m) continue;
    out.push({ line: line.trim().slice(0, 160), source: m[1]! });
    if (out.length >= 2) break;
  }
  return out;
}

/** Append the mis-attribution, naming the real owner so the correction is actionable. */
export function applyProvenanceCaveat(text: string, lies: readonly ProvenanceLie[]): string {
  if (lies.length === 0) return text;
  const srcs = [...new Set(lies.map((l) => l.source))].join(", ");
  return (
    `${text}\n\n> **Source note.** Figures above about BlackOut's own trades — win rate, graded ` +
    `plays, track record — are stamped \`${srcs}\`, but they come from BlackOut's own ledger. ` +
    `${srcs} prices instruments; it does not grade our trades. The numbers stand; the attribution ` +
    `does not.`
  );
}
