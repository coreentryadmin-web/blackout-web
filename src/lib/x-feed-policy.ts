/**
 * @BlackOutTrade feed policy — timeline = brand, engagement = silent.
 *
 * TIMELINE (what followers see):
 * - Scheduled desk posts only (x-autopost): live data + full product story + Whop footer
 * - Replies ONLY when someone @mentions us (x-replies) — never cold @tag posts
 * - NEVER post "@someone ..." as an original tweet on our profile
 *
 * SILENT ENGAGEMENT (x-growth on pay-per-use):
 * - Like + follow niche accounts; selective RT of high-signal search hits
 * - Quote-post + cold reply on FinTwit: Enterprise API only (X_API_ACCESS_TIER=enterprise)
 * - Summoned @mention replies: x-replies cron ($0.01/post on PPU)
 *
 * DESK POSTS (x-autopost):
 * - Default footer omits URL ($0.015/post PPU) — pricing link lives in profile bio
 * - X_DESK_POST_INCLUDE_URL=1 for in-tweet link ($0.20/post PPU)
 *
 * @MENTIONS (x-replies):
 * - Reply when someone @mentions us — substantive answers, no Whop link
 *
 * GOAL: followers, impressions, Whop subs — not timeline spam.
 */

/** Reject original timeline posts that @tag other users (spam pattern). */
export function isTimelinePostAllowed(text: string): boolean {
  const lines = text.split("\n");
  const firstLine = (lines[0] ?? text).trim();
  if (/^@\w/.test(firstLine)) return false;
  // Scan EVERY line, not just the first. The AI-written body (x-content-humanize's draft/enhance
  // pass) is never guaranteed single-line — nothing in that pipeline strips an internal "\n" — and
  // the trusted Whop footer (always its own last line, always self-tagging "@BlackOutTrade") is
  // appended AFTER this check used to stop looking. A first-line-only scan let an @mention of
  // another account hide on line 2+ of the body and reach the timeline uncaught, even though the
  // policy above and the prompt both say "NEVER @tag other accounts." Checking every line still
  // allows the footer's own self-tag (the `!line.includes("@BlackOutTrade")` guard below), so a
  // normal desk post is unaffected.
  for (const raw of lines) {
    const line = raw.trim();
    if (/(?:^|\s)@\w{2,}/.test(line) && !line.includes("@BlackOutTrade")) {
      return false;
    }
  }
  return true;
}

export const FEED_LIMITS = {
  /** Original desk posts per ET day (2h cadence 8am–8pm). */
  maxDeskPostsPerDay: 7,
  /** Min minutes between desk posts. */
  minDeskPostSpacingMin: 110,
} as const;
