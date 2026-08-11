import { deriveMarketState, type MarketState } from "./market-state";

/**
 * RESOLUTION CHIPS — the follow-ups that are highest value for THIS answer's state.
 *
 * WHY THESE ARE DERIVED AND NOT APPENDED. "What confirms LONG?" and "What confirms SHORT?" are the
 * two most useful next questions a member can ask — but only sometimes. After a MIXED read they are
 * literally the resolution criteria: the answer said the systems disagree, and these ask what would
 * settle it. After an aligned bearish read, "what confirms LONG?" is noise, and worse, it implies a
 * long case the answer did not make. A chip row that always shows both trains the member to ignore
 * the row, which costs the good chips too.
 *
 * So the chips follow the answer's own state:
 *
 *   MIXED           -> BOTH. The answer is unresolved and these are the resolution criteria.
 *   *-UNCONFIRMED   -> the CONFIRMING side only. There is a lean; the open question is whether it
 *                      gets confirmed, not what the other side would need.
 *   aligned / strong-> "What invalidates this?" Once a direction is established, the useful
 *                      question flips: not what would confirm it (it is confirmed) but what would
 *                      break it. This is the question that actually protects a position.
 *   NEUTRAL         -> both breakout directions, because a balanced tape resolves by breaking.
 *   NO-READ         -> nothing. The answer stated no direction; offering confirmation chips would
 *                      imply a thesis that was never given.
 *
 * THEY DO NOT REPLACE THE MODEL'S CHIPS. Largo's own follow-ups are specific and excellent ("Does
 * the call wall at 7800 hold if we break VWAP lower?") in a way a template can never be, because
 * they cite this answer's actual numbers. These are PREPENDED as the state-appropriate action and
 * the model's specific ones follow, so a member gets both the standing question and the particular
 * one.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

export const CONFIRM_LONG = "What confirms LONG?";
export const CONFIRM_SHORT = "What confirms SHORT?";
export const WHAT_INVALIDATES = "What invalidates this?";

/**
 * The state-appropriate resolution chips, most useful first.
 *
 * Returns an empty array rather than a default pair when the answer has no direction — an empty
 * row is honest, and a chip implying a thesis the answer never stated is not.
 */
export function resolutionChipsForState(state: MarketState): string[] {
  switch (state) {
    case "mixed":
      return [CONFIRM_LONG, CONFIRM_SHORT];
    case "bullish-unconfirmed":
      return [CONFIRM_LONG];
    case "bearish-unconfirmed":
      return [CONFIRM_SHORT];
    case "bullish":
    case "strong-bullish":
    case "bearish":
    case "strong-bearish":
      // A direction is established. What breaks it is more useful than what would confirm it.
      return [WHAT_INVALIDATES];
    case "neutral":
      // Balance resolves by breaking, and either side is live.
      return [CONFIRM_LONG, CONFIRM_SHORT];
    case "no-read":
    default:
      return [];
  }
}

/**
 * Merge the state chips ahead of Largo's own, de-duplicated, capped.
 *
 * De-duplication is by INTENT, not by text. The model writes "What confirms a long?" while the
 * constant says "What confirms LONG?" — normalising the characters still leaves them different
 * (that stray "a"), and the same question twice in one row is exactly the repetition this UI
 * exists to remove. A fuzzy string distance would be the wrong tool in the other direction: it
 * would eventually collapse two genuinely different chips, which costs a member a real question.
 * So only the three chips this module OWNS get a semantic key, and everything else falls back to
 * exact normalised text — a narrow rule that cannot over-suppress.
 *
 * `limit` defaults to 4: three model chips plus one standing action is a row that still scans in a
 * single glance. A MIXED answer spends two of those on the resolution pair, which is the right
 * trade precisely when the answer did not resolve.
 */
export function withResolutionChips(
  modelChips: readonly string[],
  verdictText: string,
  limit = 4
): string[] {
  const state = deriveMarketState(verdictText);
  const out: string[] = [];
  const seen = new Set<string>();

  /**
   * Semantic key for the three chips this module owns; exact normalised text for everything else.
   * Deliberately narrow — it can merge "What confirms a long?" with "What confirms LONG?" and can
   * never merge two unrelated questions that happen to share words.
   */
  const norm = (s: string) => {
    const t = s.toLowerCase();
    if (/\bconfirm/.test(t)) {
      if (/\b(long|bull|bullish|upside)\b/.test(t)) return "@confirm-long";
      if (/\b(short|bear|bearish|downside)\b/.test(t)) return "@confirm-short";
    }
    if (/\binvalidat/.test(t)) return "@invalidate";
    return t.replace(/[^a-z0-9]+/g, "");
  };

  for (const chip of [...resolutionChipsForState(state), ...modelChips]) {
    const c = String(chip ?? "").trim();
    if (!c) continue;
    const key = norm(c);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The chip offered after a card was drawn: "now put the trade detail on it".
 *
 * ASKED FOR DIRECTLY. The brief was that after generating a card Largo should offer to add entries,
 * exits and trade information — but NOT by interrupting: "when we prompt it to create a image it
 * should automatically create the image and not let user be asked for inputs". Those two pull in
 * opposite directions only if the offer blocks. As a follow-up chip it does not: the card is drawn
 * immediately from the intent the member already expressed, and the richer version is one tap away
 * for the members who want it.
 *
 * IT IS A REAL QUESTION, NOT A UI TOGGLE, and that is what makes it cheap. The chip text names the
 * artefact ("redraw the card") so `detectVisualIntent` fires on it, and it names entries/exits/stops
 * so the composer's `playbook` block — whose match is /entries|entry|target|stop/ — outscores the
 * blocks that led the first card. No new plumbing: an existing question shape drives an existing
 * scorer to a different, better layout.
 *
 * OFFERED ONLY WHEN A CARD WAS ACTUALLY REQUESTED. On an ordinary answer there is no card to
 * redraw, and a chip promising to modify one that does not exist is worse than no chip.
 */
export const REDRAW_WITH_TRADE_DETAIL = "Redraw the card with entries, exits and stops";

/** Prepend the enrichment chip when this turn drew a card. Pure; never exceeds `limit`. */
export function withCardEnrichmentChip(chips: readonly string[], drewCard: boolean, limit = 4): string[] {
  if (!drewCard) return [...chips];
  const already = chips.some((c) => /\bredraw\b/i.test(c) && /\bentr/i.test(c));
  const out = already ? [...chips] : [REDRAW_WITH_TRADE_DETAIL, ...chips];
  return out.slice(0, limit);
}
