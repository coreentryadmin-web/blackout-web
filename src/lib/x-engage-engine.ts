import {
  lookupUserByUsername,
  fetchUserTweets,
  searchRecentTweets,
  likeTweet,
  retweet,
  followUser,
  postTweet,
  countOwnMentionPostsTodayEt,
  X_BLOCK_RT_USERNAMES,
  type XTweetSearchHit,
} from "@/lib/x-api";
import {
  ENGAGEMENT_TARGETS,
  SEARCH_QUERIES,
  ENGAGE_LIMITS,
  MAX_TWEET_AGE_HOURS,
  MIN_IMPRESSIONS_FOR_REPLY,
  MAX_MENTION_POSTS_PER_DAY,
} from "@/lib/x-engage-config";
import { buildMentionOutreachTweet } from "@/lib/x-engage-mentions";
import { isReplyableTweet } from "@/lib/x-engage-replies";

export interface EngageStats {
  likes: number;
  retweets: number;
  follows: number;
  mentionPosts: number;
  scanned: string[];
  mentionPosted: string[];
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
  const replies = t.public_metrics?.reply_count ?? 99;
  let score = 0;
  if (imps >= MIN_IMPRESSIONS_FOR_REPLY) score += 3;
  if (imps >= 200) score += 4;
  if (likes >= 5) score += 2;
  if (replies < 20) score += 2;
  if (tweetAgeHours(t.created_at) < 1) score += 3;
  return score;
}

export async function runEngagementSweep(opts: {
  dryRun?: boolean;
}): Promise<EngageStats> {
  const dryRun = opts.dryRun === true;
  const stats: EngageStats = {
    likes: 0,
    retweets: 0,
    follows: 0,
    mentionPosts: 0,
    scanned: [],
    mentionPosted: [],
    errors: [],
    rateLimited: false,
  };
  const mentionPostedUsers = new Set<string>();

  const mentionPostsToday = dryRun
    ? 0
    : await countOwnMentionPostsTodayEt();
  const mentionBudget = Math.max(
    0,
    MAX_MENTION_POSTS_PER_DAY - mentionPostsToday,
  );

  async function tryLike(tweetId: string): Promise<void> {
    if (stats.likes >= ENGAGE_LIMITS.likes || stats.rateLimited) return;
    if (dryRun) {
      stats.likes += 1;
      return;
    }
    const result = await likeTweet(tweetId);
    if (result === "ok") {
      stats.likes += 1;
    } else if (result === "rate_limited") {
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

  async function tryRetweet(tweetId: string) {
    if (stats.retweets >= ENGAGE_LIMITS.retweets) return;
    if (!dryRun) {
      const ok = await retweet(tweetId);
      if (ok) stats.retweets += 1;
      else stats.errors.push(`rt:${tweetId}`);
    } else {
      stats.retweets += 1;
    }
    await sleep(ENGAGE_LIMITS.delayMs);
  }

  async function tryMentionPost(username: string, tweetText: string) {
    if (stats.mentionPosts >= ENGAGE_LIMITS.mentionPosts) return;
    if (stats.mentionPosts >= mentionBudget) return;
    const key = username.toLowerCase();
    if (mentionPostedUsers.has(key)) return;

    const text = buildMentionOutreachTweet(username, tweetText);
    if (!dryRun) {
      try {
        await postTweet(text);
        stats.mentionPosts += 1;
        stats.mentionPosted.push(username);
        mentionPostedUsers.add(key);
      } catch (e) {
        stats.errors.push(
          `mention:${username}:${e instanceof Error ? e.message : "fail"}`,
        );
      }
    } else {
      stats.mentionPosts += 1;
      stats.mentionPosted.push(username);
    }
    await sleep(ENGAGE_LIMITS.delayMs * 2);
  }

  // Phase 1 — FinTwit targets
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

    const tweets = await fetchUserTweets(user.id, 8);
    for (const t of tweets) {
      if (!isReplyableTweet(t.text)) continue;
      await tryLike(t.id);
      if (
        stats.retweets < ENGAGE_LIMITS.retweets &&
        /\$|\d{3,}|million|whale|gamma|0dte|spx|spy/.test(t.text.toLowerCase())
      ) {
        await tryRetweet(t.id);
      }
    }

    if (tweets[0]) {
      await tryMentionPost(user.username, tweets[0].text);
    }
  }

  // Phase 2 — Search discovery (high-impression niche tweets)
  const candidates: XTweetSearchHit[] = [];
  for (const query of SEARCH_QUERIES) {
    if (stats.rateLimited) break;
    const hits = await searchRecentTweets(query, 15);
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

  for (const t of candidates) {
    if (stats.rateLimited && stats.likes >= ENGAGE_LIMITS.likes - 3) break;
    const user = t.author_username!;
    stats.scanned.push(`search:@${user}`);
    await tryLike(t.id);

    const imps = t.public_metrics?.impression_count ?? 0;
    if (imps >= 50 || (t.public_metrics?.like_count ?? 0) >= 3) {
      await tryRetweet(t.id);
    }

    if (t.author_id) await tryFollow(t.author_id, user);
    await tryMentionPost(user, t.text);
  }

  return stats;
}

// Re-export for tests
export { buildMentionOutreachTweet } from "@/lib/x-engage-mentions";
