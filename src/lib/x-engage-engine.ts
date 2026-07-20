import {
  lookupUserByUsername,
  fetchUserTweets,
  searchRecentTweets,
  likeTweet,
  retweet,
  followUser,
  X_BLOCK_RT_USERNAMES,
  type XTweetSearchHit,
} from "@/lib/x-api";
import {
  ENGAGEMENT_TARGETS,
  SEARCH_QUERIES,
  ENGAGE_LIMITS,
  MAX_TWEET_AGE_HOURS,
  MIN_IMPRESSIONS_FOR_RT,
} from "@/lib/x-engage-config";
import { isReplyableTweet } from "@/lib/x-engage-replies";

export interface EngageStats {
  likes: number;
  retweets: number;
  follows: number;
  scanned: string[];
  errors: string[];
  rateLimited: boolean;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function tweetAgeHours(createdAt?: string): number {
  if (!createdAt) return 999;
  return (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
}

function scoreSearchHit(t: XTweetSearchHit): number {
  const imps = t.public_metrics?.impression_count ?? 0;
  const likes = t.public_metrics?.like_count ?? 0;
  let score = 0;
  if (imps >= MIN_IMPRESSIONS_FOR_RT) score += 4;
  if (likes >= 10) score += 2;
  if (tweetAgeHours(t.created_at) < 2) score += 1;
  return score;
}

/**
 * Silent engagement — likes, follows, selective RTs.
 * Does NOT post anything to @BlackOutTrade timeline (no @tag spam).
 */
export async function runEngagementSweep(opts: {
  dryRun?: boolean;
}): Promise<EngageStats> {
  const dryRun = opts.dryRun === true;
  const stats: EngageStats = {
    likes: 0,
    retweets: 0,
    follows: 0,
    scanned: [],
    errors: [],
    rateLimited: false,
  };

  async function tryLike(tweetId: string): Promise<void> {
    if (stats.likes >= ENGAGE_LIMITS.likes || stats.rateLimited) return;
    if (dryRun) {
      stats.likes += 1;
      return;
    }
    const result = await likeTweet(tweetId);
    if (result === "ok") stats.likes += 1;
    else if (result === "rate_limited") {
      stats.rateLimited = true;
      await sleep(ENGAGE_LIMITS.rateLimitBackoffMs);
    }
    await sleep(ENGAGE_LIMITS.delayMs);
  }

  async function tryFollow(userId: string, label: string) {
    if (stats.follows >= ENGAGE_LIMITS.follows) return;
    if (!dryRun) {
      const ok = await followUser(userId);
      if (ok) stats.follows += 1;
      else stats.errors.push(`follow:${label}`);
    } else {
      stats.follows += 1;
    }
    await sleep(ENGAGE_LIMITS.delayMs);
  }

  async function tryRetweet(tweetId: string, imps: number) {
    if (stats.retweets >= ENGAGE_LIMITS.retweets) return;
    if (imps < MIN_IMPRESSIONS_FOR_RT) return;
    if (!dryRun) {
      const ok = await retweet(tweetId);
      if (ok) stats.retweets += 1;
    } else {
      stats.retweets += 1;
    }
    await sleep(ENGAGE_LIMITS.delayMs);
  }

  for (const handle of ENGAGEMENT_TARGETS) {
    if (stats.rateLimited && stats.likes >= ENGAGE_LIMITS.likes - 5) break;
    if (X_BLOCK_RT_USERNAMES.has(handle)) continue;

    const user = await lookupUserByUsername(handle);
    if (!user) {
      stats.errors.push(`lookup:${handle}`);
      await sleep(ENGAGE_LIMITS.delayMs);
      continue;
    }
    stats.scanned.push(`@${user.username}`);
    await tryFollow(user.id, user.username);

    const tweets = await fetchUserTweets(user.id, 5);
    for (const t of tweets) {
      if (!isReplyableTweet(t.text)) continue;
      await tryLike(t.id);
      const imps = t.public_metrics?.impression_count ?? 0;
      if (imps >= MIN_IMPRESSIONS_FOR_RT) {
        await tryRetweet(t.id, imps);
      }
    }
  }

  const candidates: XTweetSearchHit[] = [];
  for (const query of SEARCH_QUERIES) {
    if (stats.rateLimited) break;
    const hits = await searchRecentTweets(query, 10);
    for (const h of hits) {
      if (tweetAgeHours(h.created_at) > MAX_TWEET_AGE_HOURS) continue;
      if (!h.author_username) continue;
      if (h.author_username.toLowerCase() === "blackouttrade") continue;
      if (!isReplyableTweet(h.text)) continue;
      candidates.push(h);
    }
    await sleep(ENGAGE_LIMITS.delayMs);
  }
  candidates.sort((a, b) => scoreSearchHit(b) - scoreSearchHit(a));

  for (const t of candidates.slice(0, 8)) {
    if (stats.rateLimited && stats.likes >= ENGAGE_LIMITS.likes - 3) break;
    stats.scanned.push(`search:@${t.author_username}`);
    await tryLike(t.id);
    const imps = t.public_metrics?.impression_count ?? 0;
    if (imps >= MIN_IMPRESSIONS_FOR_RT) await tryRetweet(t.id, imps);
    if (t.author_id) await tryFollow(t.author_id, t.author_username!);
  }

  return stats;
}
