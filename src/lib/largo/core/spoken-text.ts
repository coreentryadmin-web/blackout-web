/**
 * SPOKEN-TEXT REPAIR — turn a dictated question into one Largo can route.
 *
 * Generic speech models are trained on general English. This desk speaks a dialect they have never
 * heard, and they resolve it into the nearest ordinary words. Real, observed transcriptions:
 *
 *   "in video"      -> NVDA          "S and P 500"     -> SPX
 *   "zero D T E"    -> 0DTE          "T S L A"         -> TSLA
 *   "by calls"      -> buy calls     "cell my puts"    -> sell my puts
 *   "vee wap"       -> VWAP          "o t m"           -> OTM
 *
 * A raw transcript sends `analyzeLargoQuestion` looking for an instrument nobody named — the same
 * class of failure as the `$NOW` hijack, arriving through a different door. This repairs the known
 * cases BEFORE the text reaches the composer, where the member can still read and edit it.
 *
 * DELIBERATELY CONSERVATIVE, and that is the whole design. Every rule is anchored to a whole word,
 * a spelled-out letter run, or a following trading noun, and only rewrites to symbols in
 * KNOWN_TICKERS or acronyms in KNOWN_ACRONYMS. A loose rule would rewrite ordinary speech into
 * tickers and cause the exact bug it is meant to prevent — "I need a break" must never become "I
 * need a BRK", and "he sat in the front row" must never acquire a ticker. Words that are genuinely
 * ambiguous in ordinary English are LEFT ALONE ON PURPOSE even though they are real symbols:
 * ARM, HOOD, COIN, GOLD, ALL, NOW, ON, IT, A, CAT, KEY, SO, BE. Missing a repair costs the member
 * one edit; a wrong repair costs them a confident answer about the wrong instrument.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

import { KNOWN_TICKERS } from "@/lib/largo/question-intent";

/**
 * Company names that speech models transcribe confidently and correctly — as ENGLISH.
 *
 * Only names with no plausible non-instrument reading on a trading desk. "in video" is the
 * canonical case: nobody asks Largo about video. Deliberately ABSENT: "arm", "hood", "coin",
 * "gold", "block", "square" — each is a common English word and the cost of being wrong is high.
 */
const COMPANY_NAMES: ReadonlyArray<[RegExp, string]> = [
  // NVDA — by far the most-mangled symbol on this desk.
  [/\bin\s+video\b/gi, "NVDA"],
  [/\ben\s+video\b/gi, "NVDA"],
  [/\band\s+video\b/gi, "NVDA"],
  [/\bn\s*vidia\b/gi, "NVDA"],
  [/\benvidia\b/gi, "NVDA"],
  [/\bnvidia\b/gi, "NVDA"],
  [/\btesla\b/gi, "TSLA"],
  [/\bapple\b/gi, "AAPL"],
  [/\bmicrosoft\b/gi, "MSFT"],
  [/\bamazon\b/gi, "AMZN"],
  [/\bgoogle\b/gi, "GOOGL"],
  [/\balphabet\b/gi, "GOOGL"],
  [/\bfacebook\b/gi, "META"],
  [/\bmeta\b/gi, "META"],
  [/\bnetflix\b/gi, "NFLX"],
  [/\bbroadcom\b/gi, "AVGO"],
  [/\bpalantir\b/gi, "PLTR"],
  [/\bmicro\s*strategy\b/gi, "MSTR"],
  [/\bsuper\s*micro\b/gi, "SMCI"],
  [/\badvanced\s*micro(?:\s*devices)?\b/gi, "AMD"],
  [/\bcostco\b/gi, "COST"],
  [/\bwalmart\b/gi, "WMT"],
  [/\bdisney\b/gi, "DIS"],
  [/\bjp\s*morgan\b/gi, "JPM"],
  [/\beli\s*lilly\b/gi, "LLY"],
  [/\bunited\s*health(?:care)?\b/gi, "UNH"],
];

/** Index and ETF nicknames — how people SAY them versus what the chain calls them. */
const INSTRUMENT_NICKNAMES: ReadonlyArray<[RegExp, string]> = [
  // "S and P", "S&P 500", "S n P". The leading \b means "as and pay" cannot match: the s in "as"
  // has no word boundary before it.
  // `p\b` before the optional 500, not `p\s*`: a trailing \s* would swallow the space in
  // "S&P levels" and produce "SPXlevels".
  [/\bs\s*(?:and|&|'?n'?)\s*p\b(?:\s*500)?/gi, "SPX"],
  [/\bspoo?ie?s?\b/gi, "SPX"],
  [/\bspider'?s?\b/gi, "SPY"],
  [/\btriple\s*q'?s?\b/gi, "QQQ"],
  [/\bnasdaq\s*(?:100)?\b/gi, "NDX"],
  [/\brussell\s*(?:2000)?\b/gi, "IWM"],
  [/\bthe\s+vix\b/gi, "VIX"],
  [/\bvolatility\s+index\b/gi, "VIX"],
];

/**
 * Desk jargon a general speech model has no vocabulary for.
 *
 * "0DTE" is the worst offender because there is no ordinary-English spelling of it at all, so the
 * model guesses differently almost every time.
 */
const DESK_JARGON: ReadonlyArray<[RegExp, string]> = [
  [/\bzero\s*d\s*t\s*e\b/gi, "0DTE"],
  [/\bzero\s*day\s*(?:to\s*)?(?:expiry|expiration)\b/gi, "0DTE"],
  [/\bzero\s*days?\s*to\s*(?:expiry|expiration)\b/gi, "0DTE"],
  [/\b(?:oh|o)\s*d\s*t\s*e\b/gi, "0DTE"],
  [/\bzero\s*dte\b/gi, "0DTE"],
  [/\bgamma\s*flip\b/gi, "gamma flip"],
  [/\bnight\s*hawk\b/gi, "Night Hawk"],
  [/\bdark\s*pool\b/gi, "dark pool"],
  [/\bvee\s*wap\b/gi, "VWAP"],
  [/\bmac\s*dee\b/gi, "MACD"],
  [/\bp\s*(?:and|&|'?n'?)\s*l\b/gi, "P&L"],
  [/\bex\s*dividend\b/gi, "ex-dividend"],
];

/**
 * Trading verbs that are homophones of ordinary words.
 *
 * ANCHORED ON THE FOLLOWING NOUN, always. "by" -> "buy" is only safe in front of something you can
 * actually buy: "by calls" is not a sentence, but "by tomorrow" and "by the way" very much are, and
 * an unanchored rule would mangle both. Same for "cell" -> "sell": on its own it is biology.
 */
const TRADING_OBJECT = "(calls?|puts?|shares?|contracts?|premium|the\\s+dip|more|some|back|half|everything)";
const VERB_HOMOPHONES: ReadonlyArray<[RegExp, string]> = [
  [new RegExp(`\\b(?:by|bye)\\s+(?=${TRADING_OBJECT}\\b)`, "gi"), "buy "],
  [new RegExp(`\\bcell\\s+(?=${TRADING_OBJECT}\\b)`, "gi"), "sell "],
  [new RegExp(`\\bcells\\s+(?=${TRADING_OBJECT}\\b)`, "gi"), "sells "],
];

/**
 * Acronyms this desk says out loud, letter by letter or as a word.
 *
 * Kept SEPARATE from KNOWN_TICKERS because these are not instruments — collapsing "o t m" into a
 * ticker lookup would fail, and adding them to the ticker set would make the entity extractor
 * treat them as symbols.
 */
const KNOWN_ACRONYMS = new Set([
  "GEX", "DTE", "OTM", "ITM", "ATM", "OI", "IV", "RSI", "ATR", "EMA", "SMA",
  "VWAP", "MACD", "ETF", "IPO", "ROI", "EOD", "RTH", "AH", "PM", "HOD", "LOD",
]);

/** Acronyms said as a single word rather than spelled — uppercase them so the model sees the term. */
const SPOKEN_ACRONYMS = /\b(gex|vwap|macd|rsi|otm|itm|atm|dte|hod|lod|iv|oi)\b/gi;

/**
 * Collapse a spelled-out letter run into a symbol — "T S L A" -> TSLA, "G E X" -> GEX.
 *
 * Only when the result is a known ticker or a known acronym. Without that gate "I O U" becomes a
 * symbol and every three-letter aside turns into an instrument.
 */
function collapseSpelledRuns(text: string): string {
  return text.replace(/\b(?:[A-Za-z]\s+){1,5}[A-Za-z]\b/g, (run) => {
    const joined = run.replace(/\s+/g, "").toUpperCase();
    return KNOWN_TICKERS.has(joined) || KNOWN_ACRONYMS.has(joined) ? joined : run;
  });
}

/**
 * "the 7750 calls" survives fine, but a spoken decimal comes back as "seven seven five zero point
 * five" only rarely — Chrome emits digits for numbers. What it does NOT do is remove the filler a
 * person says while thinking, and "um SPX uh what's the level" reaches the ticker extractor with
 * two extra tokens. Stripping leading/standalone filler is safe: none of these are trading terms.
 */
const FILLER = /\b(?:um+|uh+|erm+|hmm+)\b/gi;

/** Repair a dictated question. Returns the input unchanged when nothing matches. */
export function normalizeSpokenQuestion(raw: string): string {
  if (!raw) return "";
  let out = raw;
  // Order matters: verb homophones look at the FOLLOWING word, so they run while the sentence is
  // still ordinary English, before nouns start turning into symbols.
  for (const [re, replacement] of VERB_HOMOPHONES) out = out.replace(re, replacement);
  for (const [re, replacement] of COMPANY_NAMES) out = out.replace(re, replacement);
  for (const [re, replacement] of INSTRUMENT_NICKNAMES) out = out.replace(re, replacement);
  for (const [re, replacement] of DESK_JARGON) out = out.replace(re, replacement);
  out = collapseSpelledRuns(out);
  out = out.replace(SPOKEN_ACRONYMS, (m) => m.toUpperCase());
  out = out.replace(FILLER, " ");
  // Speech APIs emit no punctuation and inconsistent spacing; tidy without changing words.
  return out.replace(/\s+/g, " ").trim();
}
