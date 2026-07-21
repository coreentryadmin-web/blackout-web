import {
  lookupUserByUsername,
  fetchUserTweets,
  searchRecentTweets,
  likeTweet,
  retweet,
  followUser,
  postReply,
  X_BLOCK_RT_USERNAMES,
  type XTweetSearchHit,
} from "@/lib/x-api";
import {
  ENGAGEMENT_TARGETS,
  SEARCH_QUERIES,
  MAX_TWEET_AGE_HOURS,
  MIN_IMPRESSIONS_FOR_RT,
} from "@/lib/x-engage-config";
import {
  isReplyableTweet,
  pickEngagementReply,
} from "@/lib/x-engage-replies";
import {
  bumpEngageRotation,
  getRepliedTweetIds,
  markTweetReplied,
} from "@/lib/x-marketing-meta";
import {
  resolveRunBudget,
  recordBudgetUse,
  pauseForRateLimit,
  engagementJitterMs,
  type RunBudget,
} from "@/lib/x-rate-budget";

export interface EngageStats {
  likes: number;
  retweets: number;
  follows: number;
  /** Public replies on FinTwit posts (visible on our profile — drives reach). */
  replies: number;
  scanned: string[];
  errors: string[];
  rateLimited: boolean;
  cronMode?: boolean;
  budget?: RunBudget;
  skippedReason?: string;
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

function rotatedTargets(rotation: number, batch: number): string[] {
  const all = [...ENGAGEMENT_TARGETS];
  const start = rotation % all.length;
  const slice: string[] = [];
  for (let i = 0; i < batch; i += 1) {
    slice.push(all[(start + i) % all.length]!);
  }
  return slice;
}

async function handleRateLimited(stats: EngageStats): Promise<void> {
  stats.rateLimited = true;
  await pauseForRateLimit();
  stats.errors.push("429: paused all X writes 15m");
}

/**
 * Silent engagement — budgeted likes/follows/RTs. Stops before X rate limits.
 */
export async function runEngagementSweep(opts: {
  dryRun?: boolean;
  cronMode?: boolean;
}): Promise<EngageStats> {
  const dryRun = opts.dryRun === true;
  const cronMode = opts.cronMode !== false;
  const budget = await resolveRunBudget({ cronMode });
  const rotation = cronMode ? await bumpEngageRotation() : 0;

  const stats: EngageStats = {
    likes: 0,
    retweets: 0,
    follows: 0,
    replies: 0,
    scanned: [],
    errors: [],
    rateLimited: false,
    cronMode,
    budget,
  };

  if (!budget.allowed) {
    stats.skippedReason = budget.reason;
    return stats;
  }

  const repliedIds = dryRun ? new Set<string>() : await getRepliedTweetIds();

  let likeCap = budget.likes;
  let followCap = budget.follows;
  let rtCap = budget.retweets;
  let replyCap = budget.replies;

  async function tryLike(tweetId: string): Promise<boolean> {
    if (likeCap <= 0 || stats.rateLimited) return false;
    if (dryRun) {
      stats.likes += 1;
      likeCap -= 1;
      return true;
    }
    const result = await likeTweet(tweetId);
    if (result === "ok") {
      stats.likes += 1;
      likeCap -= 1;
      await recordBudgetUse("likes");
    } else if (result === "rate_limited") {
      await handleRateLimited(stats);
      return false;
    }
    await sleep(engagementJitterMs());
    return result === "ok";
  }

  async function tryFollow(userId: string, label: string): Promise<boolean> {
    if (followCap <= 0 || stats.rateLimited) return false;
    if (dryRun) {
      stats.follows += 1;
      followCap -= 1;
      return true;
    }
    const result = await followUser(userId);
    if (result === "ok") {
      stats.follows += 1;
      followCap -= 1;
      await recordBudgetUse("follows");
    } else if (result === "rate_limited") {
      await handleRateLimited(stats);
      return false;
    } else {
      stats.errors.push(`follow:${label}`);
    }
    await sleep(engagementJitterMs());
    return result === "ok";
  }

  async function tryReply(
    tweet: XTweetSearchHit,
  ): Promise<boolean> {
    if (replyCap <= 0 || stats.rateLimited) return false;
    const username = tweet.author_username;
    if (!username || username.toLowerCase() === "blackouttrade") return false;
    if (repliedIds.has(tweet.id)) return false;
    const text = pickEngagementReply(username, tweet.text ?? "").slice(0, 280);
    if (text.length < 25) return false;

    if (dryRun) {
      stats.replies += 1;
      replyCap -= 1;
      return true;
    }

    try {
      await postReply(text, tweet.id);
      await markTweetReplied(tweet.id);
      await recordBudgetUse("replies");
      stats.replies += 1;
      replyCap -= 1;
      repliedIds.add(tweet.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "reply failed";
      stats.errors.push(`reply:${username}:${msg.slice(0, 80)}`);
      if (msg.includes("429") || msg.includes("rate limited")) {
        await handleRateLimited(stats);
      }
      return false;
    }
    await sleep(engagementJitterMs());
    return true;
  }

  async function tryRetweet(tweetId: string, imps: number): Promise<boolean> {
    if (rtCap <= 0 || stats.rateLimited) return false;
    if (imps < MIN_IMPRESSIONS_FOR_RT) return false;
    if (dryRun) {
      stats.retweets += 1;
      rtCap -= 1;
      return true;
    }
    const result = await retweet(tweetId);
    if (result === "ok") {
      stats.retweets += 1;
      rtCap -= 1;
      await recordBudgetUse("retweets");
    } else if (result === "rate_limited") {
      await handleRateLimited(stats);
      return false;
    }
    await sleep(engagementJitterMs());
    return result === "ok";
  }

  const targetBatch = cronMode ? 2 : 4;
  const targets = rotatedTargets(rotation, targetBatch);

  for (const handle of targets) {
    if (stats.rateLimited) break;
    if (X_BLOCK_RT_USERNAMES.has(handle)) continue;

    const user = await lookupUserByUsername(handle);
    if (!user) {
      stats.errors.push(`lookup:${handle}`);
      await sleep(engagementJitterMs());
      continue;
    }
    stats.scanned.push(`@${user.username}`);

    if (likeCap > 0) {
      const tweets = await fetchUserTweets(user.id, 2);
      for (const t of tweets) {
        if (!isReplyableTweet(t.text)) continue;
        if (!(await tryLike(t.id))) break;
      }
    }

    if (followCap > 0) {
      await tryFollow(user.id, user.username);
    }
  }

  if (!stats.rateLimited && likeCap > 0) {
    const query = SEARCH_QUERIES[rotation % SEARCH_QUERIES.length]!;
    const hits = await searchRecentTweets(query, cronMode ? 4 : 8);
    const candidates = hits
      .filter((h) => {
        if (tweetAgeHours(h.created_at) > MAX_TWEET_AGE_HOURS) return false;
        if (!h.author_username) return false;
        if (h.author_username.toLowerCase() === "blackouttrade") return false;
        return isReplyableTweet(h.text);
      })
      .sort((a, b) => scoreSearchHit(b) - scoreSearchHit(a));

    for (const t of candidates.slice(0, likeCap + (cronMode ? 1 : 2))) {
      if (stats.rateLimited) break;
      stats.scanned.push(`search:@${t.author_username}`);
      if (!(await tryLike(t.id))) break;
      const imps = t.public_metrics?.impression_count ?? 0;
      if (rtCap > 0) await tryRetweet(t.id, imps);
      // One public reply per run on a recent FinTwit post — builds reach
      // (likes alone are invisible; replies show up in threads + our profile).
      // Do not gate on impression count — search API often omits metrics; score >= 1
      // (fresh post) is enough; manual runs may post up to 2 replies.
      const replyMaxPerRun = cronMode ? 1 : 2;
      if (
        replyCap > 0 &&
        stats.replies < replyMaxPerRun &&
        tweetAgeHours(t.created_at) <= MAX_TWEET_AGE_HOURS
      ) {
        await tryReply(t);
      }
    }
  }

  return stats;
}
