/**
 * HEADLINE — turn the verdict into an actual header.
 *
 * THE BUG. `answer-contract.ts` sets `headline: verdict.split("\n")[0]`, i.e. the first LINE of the
 * Verdict section. Largo writes its verdict as one long unbroken paragraph, so "the first line" is
 * the ENTIRE verdict — four or five sentences. The card then rendered that paragraph in display
 * type as if it were a title. Measured on a live answer, the "headline" ran 380 characters:
 *
 *   "The SPX 7800 call wall is holding but weakening. It has shed -$177.8M GEX in the last 60
 *    seconds (down 3.9% from peak), and the gamma flip just migrated down 3.73 pts to 7,762.83.
 *    Dealers are getting longer (gamma regime flipped short → long at 14:38:17), which compresses
 *    vol and favors mean reversion, not breakouts. On the next 0DTE roll (tomorrow), the wall will
 *    hold unless a fresh bullish flow surge hits it — the tape is mixed…"
 *
 * A header that is a paragraph is not a header. It cannot be scanned, it sets no hierarchy, and —
 * because the same reasoning appears again below in Interpretation — it read as the answer saying
 * everything twice.
 *
 * WHAT A HEADER IS FOR. One line that resolves the question, readable at a glance, so the member
 * knows whether to read on. Everything after the first sentence is elaboration, and elaboration is
 * what the body is for.
 *
 * NOTHING IS LOST. The full verdict stays on `envelope.headline` and in the markdown fallback; this
 * is a RENDERING split, so any consumer that wants the whole thing still has it. What the card
 * stops doing is printing an essay in title type.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

/** Past this, a "header" is a paragraph. Roughly one comfortable line at desk width. */
export const HEADER_MAX_CHARS = 150;

/**
 * Sentence end: `.`/`!`/`?` followed by whitespace and a capital, or end of string.
 *
 * The capital-letter lookahead is what stops it breaking on "$177.8M", "7,762.83", "14:38:17" and
 * "0DTE." — abbreviations and decimals are everywhere in this text, and a naive split on "." would
 * cut a header in half mid-number, which is worse than a long header.
 */
const SENTENCE_END = /([.!?])\s+(?=[A-Z"“'(])/;

/** Markdown that would render as literal asterisks in display type. */
function stripEmphasis(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
}

export type SplitHeadline = {
  /** The one-line header. Never empty when input is non-empty. */
  header: string;
  /** Everything after it. Empty when the verdict was already one sentence. */
  rest: string;
};

/**
 * Split a verdict into a header and the remainder.
 *
 * Takes the FIRST SENTENCE. If that sentence is itself longer than `HEADER_MAX_CHARS` — Largo
 * sometimes writes one very long compound sentence — it is cut at the last clause boundary that
 * fits (an em-dash, semicolon, or comma) rather than mid-word, and an ellipsis marks the cut so a
 * truncated header never reads as a complete claim.
 */
export function splitHeadline(text: string | null | undefined): SplitHeadline {
  const clean = stripEmphasis(String(text ?? "").trim()).replace(/\s+/g, " ");
  if (!clean) return { header: "", rest: "" };

  const m = SENTENCE_END.exec(clean);
  let header = m ? clean.slice(0, m.index + 1).trim() : clean;
  let rest = m ? clean.slice(m.index + m[0].length).trim() : "";

  if (header.length > HEADER_MAX_CHARS) {
    const window = header.slice(0, HEADER_MAX_CHARS);
    // Prefer a real clause boundary; fall back to the last space so a word is never split.
    const cut = Math.max(window.lastIndexOf(" — "), window.lastIndexOf("; "), window.lastIndexOf(", "));
    const at = cut > HEADER_MAX_CHARS * 0.4 ? cut : window.lastIndexOf(" ");
    if (at > 0) {
      rest = `${header.slice(at).trim()}${rest ? ` ${rest}` : ""}`;
      header = `${header.slice(0, at).trim()}…`;
    }
  }

  return { header, rest };
}
