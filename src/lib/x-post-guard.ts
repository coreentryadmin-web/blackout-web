import {
  countOwnPostsTodayEt,
  minutesSinceLastOwnPost,
} from "@/lib/x-api";

export const X_POST_LIMITS = {
  /** Hard cap — today's Claude burst hit 41 originals; quality > volume. */
  maxDailyPosts: 6,
  /** Minimum spacing between scheduled posts. */
  minMinutesBetween: 90,
} as const;

const BROKEN_PATTERNS = [
  /unknown gamma/i,
  /flip flip/i,
  /put —/i,
  /call —/i,
  /#\w+/,
  /@IHate0dte/i,
  /@there\b/i,
];

/** Reject placeholder / spammy / off-brand generated text before posting. */
export function isTweetContentValid(text: string): boolean {
  const body = text.split("\n")[0] ?? text;
  if (body.length < 40) return false;
  for (const re of BROKEN_PATTERNS) {
    if (re.test(text)) return false;
  }
  return true;
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
    countOwnPostsTodayEt(),
    minutesSinceLastOwnPost(),
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
