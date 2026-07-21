/**
 * @BlackOutTrade feed policy — timeline = brand, engagement = silent.
 *
 * TIMELINE (what followers see):
 * - Scheduled desk posts only (x-autopost): live data + full product story + Whop footer
 * - Replies ONLY when someone @mentions us (x-replies) — never cold @tag posts
 * - NEVER post "@someone ..." as an original tweet on our profile
 *
 * SILENT ENGAGEMENT (x-growth):
 * - Like + follow niche accounts; selective RT of high-signal search hits
 * - Quote-tweet or reply ONLY on followed ENGAGEMENT_TARGETS (X Basic tier)
 * - Never cold-reply on search hits (403 on Basic — wastes budget + error noise)
 *
 * @MENTIONS (x-replies):
 * - Reply when someone @mentions us — substantive answers, no Whop link
 *
 * GOAL: followers, impressions, Whop subs — not timeline spam.
 */

/** Reject original timeline posts that @tag other users (spam pattern). */
export function isTimelinePostAllowed(text: string): boolean {
  const firstLine = (text.split("\n")[0] ?? text).trim();
  if (/^@\w/.test(firstLine)) return false;
  if (/(?:^|\s)@\w{2,}/.test(firstLine) && !firstLine.includes("@BlackOutTrade")) {
    return false;
  }
  return true;
}

export const FEED_LIMITS = {
  /** Original desk posts per ET day (2h cadence 8am–8pm). */
  maxDeskPostsPerDay: 7,
  /** Min minutes between desk posts. */
  minDeskPostSpacingMin: 110,
} as const;
