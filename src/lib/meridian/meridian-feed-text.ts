/**
 * Display normalization for UNTRUSTED EXTERNAL free text on the Meridian desk — Benzinga headlines,
 * catalyst titles, analyst-note titles, price-target summaries.
 *
 * MEASURED ON PROD 2026-08-21, BEKE's earnings report: the desk rendered
 *
 *   "Stock Market: Will S&amp;P 500 Open Up or Down Today?"
 *   "…Forecast Changes From Wall Street&#39;s Most Accurate Analysts"
 *
 * literally, entity and all. `/api/market/meridian/event` served NINE such strings for that one
 * event across six fields — `catalysts[].title`, `earnings_headlines[].title`,
 * `analyst_revisions[].title`, `price_targets[].summary`, `catalyst_briefs[].title`.
 *
 * The repo already had the fix and Meridian was not using it: `sanitizeFeedText` has decoded these
 * since the LARGO-6 hardening work, so the SAME Benzinga headline reads clean through Largo and raw
 * through the desk. This module is the one-line boundary that closes that gap — it does not
 * reimplement the decoder, it points Meridian at the vetted one.
 *
 * WHY THIS IS NOT MERELY COSMETIC. `shapeAnalyst` derives the FIRM from the title
 * (`/^([^:]+):/`) and the ACTION from keyword tests, and `loadPriceTargetRows` parses a price
 * target out of title+teaser+body. Parsing encoded text puts entities inside a derived `firm`
 * value and lets a numeric entity hide a character the parser is looking for. Decode BEFORE the
 * parse, never after — the call sites are ordered that way deliberately.
 *
 * Pure and total: no IO, no throw, no `server-only`, so it is directly unit-testable.
 */

import { sanitizeFeedText } from "@/lib/largo/sanitize-feed-text";

/**
 * Decode entities and strip anything that could pose as markup, for text going to a member's
 * screen. Delegates to `sanitizeFeedText` rather than copying its entity table — one decoder,
 * one place to fix, and Meridian cannot drift away from what Largo shows for the same headline.
 *
 * Returns "" for null/undefined/non-strings; never throws.
 *
 * NON-STRINGS ARE DROPPED, NOT STRINGIFIED. `sanitizeFeedText` does `String(s ?? "")`, so a
 * malformed feed row whose `title` arrived as an object yields the literal text
 * "[object Object]" — a string a panel would happily render as a headline. Caught by the test
 * below, not by reading the code. The same hole exists on the Largo side; flagged there rather
 * than edited from this lane.
 */
export function meridianFeedText(value: unknown): string {
  if (typeof value !== "string") return "";
  return sanitizeFeedText(value);
}

/**
 * The same, but absence stays absence. An empty headline is NOT an empty string a panel should
 * render — it is a field that is not there, and the caller must be able to tell.
 */
export function meridianFeedTextOrNull(value: unknown): string | null {
  const out = meridianFeedText(value);
  return out.length > 0 ? out : null;
}

/**
 * Does this headline read as a sell-side analyst rating/price-target action (upgrade, downgrade,
 * initiation, PT change, reiteration) rather than the company's own forward guidance?
 *
 * Same keyword set `shapeAnalyst` (`meridian-catalyst-enrich.ts`) already uses to classify
 * `analyst_revisions[].action` — reused rather than re-invented so the two call sites cannot drift
 * into disagreeing about what counts as an analyst action.
 *
 * Exists because Benzinga's own "guidance" news channel is broader than the word implies: a live
 * fill-rate check (2026-08-25, `meridian-earnings-data-inventory.mjs --min-importance=4`) found
 * `enrichment.corporate_guidance` at 0% fill even for mega-cap earnings, while every
 * `catalyst_briefs` item tagged `type: "guidance"` on a real print was, in fact, an analyst
 * rating/PT note — the exact same headline `analyst_revisions` already carries elsewhere on the
 * same page under its own correct label. `shapeCatalystBriefs` uses this to drop that duplicate
 * rather than let it reach a member mislabeled "GUIDANCE".
 */
export function looksLikeAnalystAction(title: string): boolean {
  // Deliberately narrower than `shapeAnalyst`'s action-classification keywords: those run on rows
  // Benzinga has ALREADY typed as an analyst note, so a bare "raises"/"lowers"/"cut" is unambiguous
  // there. Here the input is a "guidance"-typed headline, and a company genuinely "raises
  // guidance" or "lowers full-year outlook" using those exact verbs -- matching on the verb alone
  // would misclassify real corporate guidance as an analyst note. So this matches only on
  // vocabulary that is analyst-specific regardless of context: a price target, a rating tier, or
  // an explicit upgrade/downgrade/coverage-initiation action.
  return /price target|upgrade|downgrade|overweight|underweight|outperform|equal.?weight|initiat(?:es|ed|ing|ion)?\s+coverage|reiterat\w*\s+(?:buy|sell|hold|overweight|underweight|outperform|neutral)/i.test(
    title
  );
}
