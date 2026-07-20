import {
  countOwnPostsTodayEt,
  minutesSinceLastOwnPost,
  fetchUserTweets,
  X_ACCOUNT_USER_ID,
} from "@/lib/x-api";

/** One showcase post every 2 hours (8am–8pm ET) ≈ 7/day max. */
export const X_POST_LIMITS = {
  maxDailyPosts: 7,
  minMinutesBetween: 110,
} as const;

import { isTimelinePostAllowed } from "@/lib/x-feed-policy";

const BROKEN_PATTERNS = [
  /unknown gamma/i,
  /flip flip/i,
  /put —/i,
  /call —/i,
  /#\w+/,
  /@IHate0dte/i,
  /@there\b/i,
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

/** Product posts include Whop footer — exclude @mention outreach from spacing cap. */
export async function countOwnProductPostsTodayEt(): Promise<number> {
  const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 30);
  const todayEt = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  return tweets.filter((t) => {
    if (!t.created_at || !t.text) return false;
    if (t.text.trim().startsWith("@")) return false;
    const d = new Date(t.created_at).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    return d === todayEt;
  }).length;
}

export async function minutesSinceLastProductPost(): Promise<number | null> {
  const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 15);
  const latest = tweets.find(
    (t) => t.created_at && t.text && !t.text.trim().startsWith("@"),
  )?.created_at;
  if (!latest) return null;
  return (Date.now() - new Date(latest).getTime()) / 60_000;
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

// Legacy export for tests
export { countOwnPostsTodayEt, minutesSinceLastOwnPost };
