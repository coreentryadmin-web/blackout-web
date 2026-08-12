import { stripLargoBlocks } from "@/features/largo/blocks/extract";
import { extractLevels } from "@/lib/largo/core/level-extract";
import { extractGexShifts } from "@/lib/largo/core/gex-shift-extract";
import { analyzeLargoQuestion } from "@/lib/largo/question-intent";
import { extractSystemReads } from "@/lib/largo/core/system-reads-extract";
import {
  evidenceLevelsForEnvelope,
  type MarketEvidence,
} from "@/lib/largo/core/market-evidence";
import { buildTradeDecisionRead } from "@/lib/largo/core/decision-read";
import { isPlayQuestion } from "@/lib/largo/core/trade-question";
import { hasComparisonBlock } from "@/features/largo/answer/desk-read-layout";
import { deriveMarketState, marketStateToBias } from "@/lib/largo/core/market-state";
import {
  makeEnvelope,
  type BieAnswerEnvelope,
  type BieBias,
  type BieConfidenceLevel,
  type BieEvidence,
  type BieEvidenceKind,
  type BieFreshness,
} from "@/lib/bie/answer-envelope";

/**
 * Largo's ANSWER CONTRACT — the section template Largo writes to, and the deterministic parser
 * that turns a conforming answer into the structured envelope the UI renders as cards.
 *
 * WHY A TEMPLATE AND A PARSER, RATHER THAN STRUCTURED OUTPUT.
 * The obvious way to guarantee structure is a required `emit_answer` tool whose schema is the
 * envelope. It was rejected on purpose: the answer would then arrive as one JSON blob at the end
 * of the turn, so the terminal could no longer stream tokens and a member would watch a thinking
 * state for the entire 40-90s of a heavy question. Streaming is the thing that makes a slow answer
 * feel alive. So Largo writes PROSE — which streams — to a fixed set of headings, and this module
 * recovers the structure from the prose afterwards.
 *
 * The cost of that choice is drift: a model can wander off the template. That is handled honestly
 * rather than hidden — `validateAnswerContract` reports exactly which required sections are
 * missing, so a non-conforming answer is visible in telemetry instead of silently degrading to
 * plain markdown forever. Parsing NEVER throws and never invents: an unparseable answer yields
 * `null` and the caller falls back to rendering the raw markdown, which is the current behaviour.
 *
 * THE HONESTY SPINE. The section names are not cosmetic. `Facts` and `Interpretation` are separate
 * headings because the single most damaging thing Largo can do is present a read as a
 * measurement. `Conflicts` exists so contradicting signals are stated rather than smoothed into a
 * clean story. `Data` exists so "I could not see X" is a first-class answer instead of a silent
 * omission. Every one of these maps onto a field the envelope already carries and the UI already
 * renders — see answer-envelope.ts.
 */

/** Canonical section headings, in the order Largo must write them. */
export const ANSWER_SECTIONS = [
  "Verdict",
  "Facts",
  "Interpretation",
  "Confidence",
  "Conflicts",
  "Risk",
  "Data",
  "Bottom line",
] as const;

export type AnswerSectionName = (typeof ANSWER_SECTIONS)[number];

/**
 * Sections every answer must carry, however short the question.
 *
 * Deliberately only three. "SPX?" should not be padded into an eight-heading essay — that is the
 * corporate-fluff failure mode, just structured. `Verdict` answers the question, `Facts` shows the
 * numbers it rests on, and `Data` states their freshness. The other five are conditional: they
 * appear when there IS an interpretation to separate, a conflict to name, a risk to flag.
 */
export const REQUIRED_SECTIONS: readonly AnswerSectionName[] = ["Verdict", "Data"];

/**
 * `Facts` is required CONDITIONALLY — whenever the answer states a figure.
 *
 * Measured live 2026-08-10: the prompt-injection probe was the ONLY non-conforming answer in a
 * 15-question run, and it was non-conforming because of a contradiction I had written into the
 * contract itself. The preamble tells Largo that "a refusal is a **Verdict** plus a **Data** line
 * saying what you could not see" — and then the validator demanded **Facts** anyway. Largo did
 * exactly what it was told and was scored as failing.
 *
 * Forcing a Facts heading onto a refusal is worse than pointless: a refusal HAS no measurements,
 * so the only way to satisfy the rule is to pad the section, and a Facts block padded with
 * non-facts is precisely the confusion the fact/interpretation split exists to prevent.
 *
 * The rule that actually matters is narrower and stronger: **a number without a Facts line is an
 * unsourced number.** So Facts is required exactly when the prose carries one.
 */
export function requiresFactsSection(prose: string): boolean {
  // Ignore times, dates and section-ordinal noise; look for a figure a member could act on.
  const stripped = prose
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|ET|UTC|Z)?\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  return /(?:\$\s?\d|\b\d[\d,]*\.\d|\b\d[\d,]{2,}\b|\b\d+(?:\.\d+)?\s?%)/.test(stripped);
}

/**
 * Detect a canonical section heading and return its name plus any inline body on the same line.
 *
 * Accepts every shape a model realistically produces: `**Verdict** — text`, `**Facts**` alone on
 * its line, `## Verdict: text`, `Verdict - text`. Largo is instructed to write the first form; the
 * rest are accepted because throwing away a well-formed answer over punctuation costs the member
 * their answer and buys nothing.
 *
 * A line that begins with a bullet marker is NEVER a heading. Without that rule
 * `- **Call wall** — SPX 6100` inside Facts reads as a heading, truncating Facts and swallowing
 * the remainder of the answer into a bogus section — see the test of the same name.
 */
function matchHeading(line: string): { name: AnswerSectionName; inline: string } | null {
  const raw = line.trim();
  // Bullet markers are `- `, `• ` and `* ` — the space matters. Testing for a bare leading `*`
  // would reject `**Verdict**`, i.e. every heading Largo is actually instructed to write.
  if (!raw || /^(?:[-•]\s|\*\s)/.test(raw)) return null;
  const withoutHashes = raw.replace(/^#{1,4}\s*/, "");
  const m = /^(?:\*\*\s*([A-Za-z][A-Za-z ]{2,20}?)\s*\*\*|([A-Za-z][A-Za-z ]{2,20}?))\s*(?:(?:—|–|-|:)\s*(.*))?$/.exec(
    withoutHashes
  );
  if (!m) return null;
  const candidate = (m[1] ?? m[2] ?? "").trim();
  const known = ANSWER_SECTIONS.find((s) => s.toLowerCase() === candidate.toLowerCase());
  if (!known) return null;
  return { name: known, inline: (m[3] ?? "").trim() };
}

const BIAS_WORDS: Record<string, BieBias> = {
  bullish: "bullish",
  bearish: "bearish",
  neutral: "neutral",
  mixed: "mixed",
  conflicted: "mixed",
};

const CONFIDENCE_WORDS: Record<string, BieConfidenceLevel> = {
  high: "high",
  moderate: "moderate",
  medium: "moderate",
  low: "low",
  insufficient: "insufficient",
  none: "insufficient",
};

const FRESHNESS_WORDS: Record<string, BieFreshness> = {
  live: "live",
  recent: "recent",
  stale: "stale",
  delayed: "stale",
  unknown: "unknown",
};

/** Leading marker that tags a fact line's honesty kind, e.g. `- [fact] SPX 6012.40`. */
const KIND_RE = /^[-*•]?\s*\[(fact|calc|inference|scenario)\]\s*/i;

/** Trailing provenance, e.g. `… (Polygon quote · 14:32:05Z · live)`. Source is required inside the
 *  parens; the timestamp and freshness are optional because not every read exposes an `asOf`. */
const PROVENANCE_RE = /\(([^()]+?)\)\s*$/;

/**
 * ONE SECTION'S PROSE, by name.
 *
 * Exported for the card renderer, which needs the VERDICT SENTENCE and was previously taking the
 * first non-empty line of the answer instead. Every contract-conforming answer opens with the
 * literal heading `**Verdict**`, so that line IS the word "Verdict" — and it was rendered as the
 * card's largest text, on every replayed card, in production. See `answerSectionText`.
 *
 * Returns "" for a missing section or an unparseable answer; never throws.
 */
export function answerSectionText(markdown: string, name: AnswerSectionName): string {
  try {
    return splitSections(stripLargoBlocks(markdown)).get(name.toLowerCase()) ?? "";
  } catch {
    return "";
  }
}

function splitSections(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current) out.set(current.toLowerCase(), buf.join("\n").trim());
    buf = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const h = matchHeading(line);
    if (h) {
      flush();
      current = h.name;
      if (h.inline) buf.push(h.inline);
      continue;
    }
    if (current) buf.push(line);
  }
  flush();
  return out;
}

function bulletLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

function parseProvenance(text: string): { text: string; provenance?: BieEvidence["provenance"] } {
  const m = PROVENANCE_RE.exec(text);
  if (!m) return { text: text.trim() };
  const parts = m[1]!.split("·").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { text: text.trim() };
  const source = parts[0]!;
  let asOf: string | null = null;
  let freshness: BieFreshness | undefined;
  for (const p of parts.slice(1)) {
    const f = FRESHNESS_WORDS[p.toLowerCase()];
    if (f) {
      freshness = f;
      continue;
    }
    asOf = p;
  }
  return {
    text: text.slice(0, m.index).trim(),
    provenance: { source, asOf, freshness },
  };
}

function parseEvidence(body: string): BieEvidence[] {
  const out: BieEvidence[] = [];
  for (const raw of bulletLines(body)) {
    const km = KIND_RE.exec(raw);
    // Untagged lines default to `fact` ONLY inside the Facts section (this function's callers
    // pass Interpretation separately with an explicit kind), because that is where Largo is told
    // to put measurements. Defaulting the other way round would let an unlabelled opinion be
    // rendered with a "Fact" chip, which is the exact confusion the taxonomy exists to prevent.
    const kind = (km?.[1]?.toLowerCase() as BieEvidenceKind | undefined) ?? "fact";
    const rest = km ? raw.slice(km[0].length) : raw;
    const { text, provenance } = parseProvenance(rest);
    if (!text) continue;
    out.push({ kind, text, provenance });
  }
  return out;
}

function firstMatch<T>(text: string, table: Record<string, T>): T | undefined {
  const lower = text.toLowerCase();
  for (const [word, value] of Object.entries(table)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return value;
  }
  return undefined;
}

export type AnswerContractReport = {
  /** True when every REQUIRED_SECTIONS heading was found. */
  conforms: boolean;
  /** Required headings that were absent — the actionable half of a non-conforming answer. */
  missing: AnswerSectionName[];
  /** Canonical headings that WERE found, required or not. */
  present: AnswerSectionName[];
};

/**
 * Which contract sections an answer actually carries.
 *
 * Reported rather than enforced. A missing section must never suppress an answer the member is
 * waiting on — the failure mode of a hard gate here is a blank terminal, which is strictly worse
 * than a well-informed answer with an unusual shape. This exists so drift is MEASURABLE.
 */
export function validateAnswerContract(markdown: string): AnswerContractReport {
  const sections = splitSections(markdown);
  const present = ANSWER_SECTIONS.filter((s) => sections.has(s.toLowerCase()));
  const missing = REQUIRED_SECTIONS.filter((s) => !sections.has(s.toLowerCase()));
  // Facts is conditional: demanded only when the answer actually states a figure. See
  // requiresFactsSection for the live measurement that produced this rule.
  if (!sections.has("facts") && requiresFactsSection(stripLargoBlocks(markdown))) missing.push("Facts");
  return { conforms: missing.length === 0, missing: [...missing], present: [...present] };
}

/**
 * Parse a contract-conforming answer into the envelope the UI renders.
 *
 * Returns `null` when the answer carries no usable structure, so the caller keeps its existing
 * raw-markdown rendering. Never throws — a parser fault must not cost a member their answer.
 */
export function parseAnswerEnvelope(
  markdown: string,
  /** The turn's raw tool results, for structured blocks the prose cannot carry. */
  capturedResults?: readonly unknown[],
  /** Canonical validated evidence — when present, overrides levels and system reads. */
  marketEvidence?: MarketEvidence | null,
  /** Member question — used to build decision-first trade layout. */
  question?: string | null
): BieAnswerEnvelope | null {
  let sections: Map<string, string>;
  try {
    // Parse the PROSE only. A ```blackout payload contains lines like `"type": "levels",` which
    // the heading matcher would never accept, but its bullet-shaped content could still pollute
    // the Facts evidence list with fragments of JSON.
    sections = splitSections(stripLargoBlocks(markdown));
  } catch {
    return null;
  }
  const get = (name: AnswerSectionName) => sections.get(name.toLowerCase()) ?? "";

  const verdict = get("Verdict");
  const facts = get("Facts");
  const playQ = isPlayQuestion(question);
  // Require a verdict. Facts can be thin on play questions when levels come from tool evidence.
  if (!verdict) return null;
  if (!facts && !playQ) return null;

  // The instrument this answer is about, resolved through the SAME entity layer the rest of Largo
  // uses so the Night Hawk row cannot be filtered on a different spelling than the answer discusses.
  const tickerHint = analyzeLargoQuestion(verdict, []).tickerHint ?? null;

  const evidence: BieEvidence[] = parseEvidence(facts);
  for (const line of bulletLines(get("Interpretation"))) {
    const { text, provenance } = parseProvenance(line.replace(KIND_RE, ""));
    if (text) evidence.push({ kind: "inference", text, provenance });
  }
  if (evidence.length === 0) {
    const hasToolGrounding =
      playQ &&
      marketEvidence &&
      (marketEvidence.levels.length > 0 ||
        marketEvidence.nightHawk != null ||
        (marketEvidence.spot?.authoritative != null));
    if (!hasToolGrounding) return null;
  }

  const confidenceBody = get("Confidence");
  const confidenceLevel = firstMatch(confidenceBody, CONFIDENCE_WORDS);
  const risk = bulletLines(get("Risk"));

  const canonicalLevels =
    marketEvidence && marketEvidence.levels.length > 0
      ? evidenceLevelsForEnvelope(marketEvidence)
      : extractLevels(evidence);

  const envelope = makeEnvelope({
    headline: verdict.split(/\r?\n/)[0]!.trim(),
    bias: marketStateToBias(deriveMarketState(verdict)),
    // ABSENT, not defaulted. The `why` is the whole point of the confidence field — a bare level
    // is an arbitrary number wearing a word — and this code used to say exactly that while doing
    // the opposite: `?? "moderate"` invented a level whenever Largo wrote no Confidence section,
    // and the UI printed "MODERATE CONFIDENCE" above "No confidence rationale was given."
    // An omitted section now yields an omitted badge.
    confidence: confidenceLevel
      ? {
          level: marketEvidence?.preciseRecommendationsBlocked ? "insufficient" : confidenceLevel,
          why: marketEvidence?.preciseRecommendationsBlocked
            ? `${confidenceBody.trim()} Sources disagree on spot — precise levels withheld.`.trim()
            : confidenceBody.trim(),
        }
      : marketEvidence?.preciseRecommendationsBlocked
        ? {
            level: "insufficient",
            why: "Spot prices disagree across sources — precise entry/stop/target levels are withheld.",
          }
        : undefined,
    // Every canonical section Largo actually wrote becomes a card, in contract order. Conflicts
    // and Data ride here rather than being flattened into a caveat list so the UI can give them
    // their own headings — "these signals disagree" and "this number is 12 minutes old" are
    // findings a member acts on, not footnotes.
    sections: ANSWER_SECTIONS.filter((name) => get(name)).map((name) => ({
      title: name,
      body: get(name),
    })),
    evidence,
    // The desk-read card leads with a levels grid, and it was rendering EMPTY on every answer:
    // the numbers were in the evidence prose and nothing lifted them out. extractLevels reads the
    // already-structured evidence rows against a closed label set, so a miss costs one grid row
    // and can never produce a wrong one.
    levels: canonicalLevels,
    // Structured, from the tool's own output — see gex-shift-extract.ts.
    gexShifts: extractGexShifts(capturedResults)?.shifts,
    // Cross-system consensus, from the same tool results — see system-reads-extract.ts.
    systemReads: extractSystemReads(capturedResults, tickerHint) ?? undefined,
    invalidation: marketEvidence?.preciseRecommendationsBlocked ? null : risk[0] ?? null,
  });

  const hasComparison = hasComparisonBlock(markdown);
  const tradeDecision = buildTradeDecisionRead(question, envelope, marketEvidence, {
    hasComparisonBlock: hasComparison,
  });
  if (tradeDecision) {
    return {
      ...envelope,
      tradeDecision: {
        ticker: tradeDecision.ticker,
        actionLabel: tradeDecision.actionLabel,
        notOnBoardWarning: tradeDecision.notOnBoardWarning,
        existingPlay: tradeDecision.existingPlay,
        boardPlay: tradeDecision.boardPlay,
        isSpeculative: tradeDecision.isSpeculative,
        signalRows: tradeDecision.signalRows.map((r) => ({
          signal: r.signal,
          read: r.read,
          bias: r.bias,
          glyph: r.glyph,
        })),
      },
    };
  }

  return envelope;
}
