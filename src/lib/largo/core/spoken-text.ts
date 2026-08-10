/**
 * SPOKEN-TEXT REPAIR — turn a dictated question into one Largo can route.
 *
 * Generic speech models mangle exactly the vocabulary this product runs on. Real transcriptions:
 *
 *   "in video"      -> NVDA          "S and P"        -> SPX
 *   "zero D T E"    -> 0DTE          "gamma flip"     -> (fine, left alone)
 *   "Q Q Q"         -> QQQ           "T S L A"        -> TSLA
 *
 * A raw transcript sends `extractTicker` looking for an instrument nobody named — the same class
 * of failure as the `$NOW` hijack, arriving through a different door. This repairs the known cases
 * BEFORE the text reaches the composer, where the member can still read and edit it.
 *
 * DELIBERATELY CONSERVATIVE. Every rule is anchored to a whole word or a spelled-out letter run,
 * and only rewrites to symbols in KNOWN_TICKERS. A loose rule would rewrite ordinary speech into
 * tickers and cause the exact bug it is meant to prevent — "I need a break" must never become
 * "I need a BRK". When unsure, leave the words alone: a member re-reading their own question and
 * fixing it is a small cost; a silently rewritten question is not.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

import { KNOWN_TICKERS } from "@/lib/largo/question-intent";

/**
 * Homophones that are unambiguous in a trading context.
 *
 * Only phrases with no plausible non-ticker reading on this desk. "in video" is the canonical
 * case — nobody asks Largo about video. Phrases that ARE ambiguous in ordinary speech
 * (e.g. "all" -> ALL, "now" -> NOW) are deliberately absent.
 */
const HOMOPHONES: ReadonlyArray<[RegExp, string]> = [
  [/\bin\s+video\b/gi, "NVDA"],
  [/\bn\s*vidia\b/gi, "NVDA"],
  [/\bnvidia\b/gi, "NVDA"],
  [/\btesla\b/gi, "TSLA"],
  [/\bapple\b/gi, "AAPL"],
  [/\bmeta\b/gi, "META"],
  [/\bmicrosoft\b/gi, "MSFT"],
  [/\bamazon\b/gi, "AMZN"],
  [/\bgoogle\b/gi, "GOOGL"],
  [/\bs\s*(?:and|&|'?n'?)\s*p\s*(?:500)?\b/gi, "SPX"],
  [/\bspider\b/gi, "SPY"],
  [/\bthe\s+vix\b/gi, "VIX"],
  [/\bzero\s*d\s*t\s*e\b/gi, "0DTE"],
  [/\bo\s*d\s*t\s*e\b/gi, "0DTE"],
  [/\bgex\b/gi, "GEX"],
  [/\bnight\s*hawk\b/gi, "Night Hawk"],
];

/**
 * Collapse a spelled-out letter run into a symbol — "T S L A" -> TSLA.
 *
 * Only when the result is a known ticker. Without that gate "I O U" becomes a symbol and any
 * three-letter aside turns into an instrument.
 */
function collapseSpelledTickers(text: string): string {
  return text.replace(/\b(?:[A-Za-z]\s+){1,5}[A-Za-z]\b/g, (run) => {
    const joined = run.replace(/\s+/g, "").toUpperCase();
    return KNOWN_TICKERS.has(joined) ? joined : run;
  });
}

/** Repair a dictated question. Returns the input unchanged when nothing matches. */
export function normalizeSpokenQuestion(raw: string): string {
  if (!raw) return "";
  let out = raw;
  for (const [re, replacement] of HOMOPHONES) out = out.replace(re, replacement);
  out = collapseSpelledTickers(out);
  // Speech APIs emit no punctuation and inconsistent spacing; tidy without changing words.
  return out.replace(/\s+/g, " ").trim();
}
