import {
  fetchUserTweets,
  X_ACCOUNT_USER_ID,
  type XTweet,
} from "@/lib/x-api";
import { minutesSinceIso } from "@/lib/ws/timestamp-freshness";

/** One showcase post every 2 hours (8am–8pm ET) ≈ 7/day max. */
export const X_POST_LIMITS = {
  maxDailyPosts: 7,
  minMinutesBetween: 110,
} as const;

import { isTimelinePostAllowed } from "@/lib/x-feed-policy";

const BROKEN_PATTERNS = [
  /unknown gamma/i,
  /flip flip/i,
  /flip\s*—/i,
  /put\s*—/i,
  /call\s*—/i,
  /#\w+/,
  /@IHate0dte/i,
  /@there\b/i,
  /isn't moving on vibes/i,
];

export function isTweetContentValid(text: string): boolean {
  const body = text.split("\n")[0] ?? text;
  if (body.length < 40) return false;
  if (!isTimelinePostAllowed(text)) return false;
  for (const re of BROKEN_PATTERNS) {
    if (re.test(text)) return false;
  }
  return true;
}

/**
 * True for a tweet on our own timeline that is GROWTH ENGAGEMENT (x-engage-engine.ts), not a
 * scheduled desk product post (x-autopost) — the set `countOwnProductPostsTodayEt`/
 * `minutesSinceLastProductPost` below must exclude from the daily-cap/spacing checks.
 *
 * BUG THIS FIXES: the only check used to be `text.trim().startsWith("@")`, which correctly
 * catches a mention REPLY (`pickEngagementReply`/`pickMentionReply` always lead with
 * `@handle `) but silently MISSES a QUOTE tweet. `pickEngagementQuote` (x-engage-replies.ts)
 * deliberately strips that leading `@handle ` — "no leading @ (quoted tweet provides
 * context)", per its own doc comment — so a posted quote-tweet's text never starts with "@"
 * and sailed straight through this filter as if it were a real desk post. `fetchUserTweets`
 * requests `exclude=retweets,replies`, but a quote-tweet is its own standalone tweet to the X
 * API (not a "reply"), so it is NOT excluded server-side either — it comes back in the same
 * list as real desk posts, with nothing to mark it as engagement except its (now unprefixed)
 * text.
 *
 * Blast radius once X_API_ACCESS_TIER=enterprise is armed (quote-posting is gated behind
 * that tier — see x-engage-engine.ts's `tryQuote`/`allowVisibleEngage`): every quote-tweet the
 * growth engine posts inflates `postsToday` (toward the 7/day desk cap) and can overwrite
 * `minutesSinceLastProductPost`'s "latest" pick with an unrelated engagement post — so a real
 * scheduled x-autopost desk tweet gets skipped with "Daily cap reached" or "Too soon since
 * last post" because of growth-engagement activity that has nothing to do with the desk
 * content schedule.
 *
 * Fix: also exclude a tweet whose `referenced_tweets` marks it as "quoted" — the field the X
 * API itself uses to say "this tweet quotes another", independent of whatever the body text
 * happens to start with.
 */
export function isGrowthEngagementTweet(t: Pick<XTweet, "text" | "referenced_tweets">): boolean {
  if (t.text.trim().startsWith("@")) return true;
  return t.referenced_tweets?.some((r) => r.type === "quoted") ?? false;
}

/** Product posts include Whop footer — exclude growth-engagement activity from spacing cap. */
export async function countOwnProductPostsTodayEt(): Promise<number> {
  const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 30);
  const todayEt = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  return tweets.filter((t) => {
    if (!t.created_at || !t.text) return false;
    if (isGrowthEngagementTweet(t)) return false;
    const d = new Date(t.created_at).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    return d === todayEt;
  }).length;
}

export async function minutesSinceLastProductPost(): Promise<number | null> {
  const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 15);
  const latest = tweets.find(
    (t) => t.created_at && t.text && !isGrowthEngagementTweet(t),
  )?.created_at;
  if (!latest) return null;
  return minutesSinceIso(latest);
}

export interface PostGuardResult {
  allowed: boolean;
  reason?: string;
  postsToday?: number;
  minutesSinceLast?: number | null;
}

export async function checkPostGuard(
  opts: { bypassDailyCap?: boolean } = {},
): Promise<PostGuardResult> {
  const [postsToday, minutesSinceLast] = await Promise.all([
    countOwnProductPostsTodayEt(),
    minutesSinceLastProductPost(),
  ]);

  if (!opts.bypassDailyCap && postsToday >= X_POST_LIMITS.maxDailyPosts) {
    return {
      allowed: false,
      reason: `Daily cap reached (${postsToday}/${X_POST_LIMITS.maxDailyPosts})`,
      postsToday,
      minutesSinceLast,
    };
  }

  if (
    minutesSinceLast != null &&
    minutesSinceLast < X_POST_LIMITS.minMinutesBetween
  ) {
    return {
      allowed: false,
      reason: `Too soon (${Math.round(minutesSinceLast)}m since last post, need ${X_POST_LIMITS.minMinutesBetween}m)`,
      postsToday,
      minutesSinceLast,
    };
  }

  return { allowed: true, postsToday, minutesSinceLast };
}
