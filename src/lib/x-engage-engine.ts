import {
  lookupUserByUsername,
  fetchUserTweets,
  searchRecentTweets,
  likeTweet,
  retweet,
  followUser,
  postReply,
  postQuoteTweet,
  X_BLOCK_RT_USERNAMES,
  type XTweet,
  type XTweetSearchHit,
} from "@/lib/x-api";
import {
  ENGAGEMENT_TARGETS,
  SEARCH_QUERIES,
  MAX_TWEET_AGE_HOURS,
  MIN_IMPRESSIONS_FOR_RT,
  isEngagementTarget,
} from "@/lib/x-engage-config";
import {
  isReplyableTweet,
  pickEngagementQuote,
  pickEngagementReply,
} from "@/lib/x-engage-replies";
import {
  bumpEngageRotation,
  getRepliedTweetIds,
  markTweetReplied,
} from "@/lib/x-marketing-meta";
import {
  xApiEnterpriseAccess,
  xMarketingSilentOnly,
} from "@/lib/x-marketing-env";
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
  /** Summoned @mention replies — use x-replies cron, not growth sweep. */
  replies: number;
  /** Quote-posts — Enterprise API only; disabled on pay-per-use. */
  quotes: number;
  /** Quote/cold-reply blocked by self-serve API policy (403). */
  skipped403: number;
  scanned: string[];
  errors: string[];
  rateLimited: boolean;
  cronMode?: boolean;
  budget?: RunBudget;
  skippedReason?: string;
  /** Likes + follows only — no quote/reply/RT. */
  silentOnly?: boolean;
  /** ppu = likes/follows/RT; enterprise adds FinTwit quote/reply. */
  apiTier?: "ppu" | "enterprise";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function tweetAgeHours(createdAt?: string): number {
  if (!createdAt) return 999;
  return (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
}

function isSelfServeApiBlock(msg: string): boolean {
  return (
    msg.includes("(403)") ||
    /only reply to or quote posts/i.test(msg) ||
    /enterprise plan/i.test(msg)
  );
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

function pickVisibleEngageTweet(tweets: XTweet[]): XTweet | null {
  for (const t of tweets) {
    if (tweetAgeHours(t.created_at) > MAX_TWEET_AGE_HOURS) continue;
    if (!isReplyableTweet(t.text ?? "")) continue;
    return t;
  }
  return null;
}

async function handleRateLimited(stats: EngageStats): Promise<void> {
  stats.rateLimited = true;
  await pauseForRateLimit();
  stats.errors.push("429: paused all X writes 15m");
}

/**
 * Growth engagement on pay-per-use: likes, follows, selective RT on search hits.
 * FinTwit quote/reply requires X_API_ACCESS_TIER=enterprise (self-serve forbids
 * cold quotes; replies only when @mentioned — see x-replies cron).
 */
export async function runEngagementSweep(opts: {
  dryRun?: boolean;
  cronMode?: boolean;
  silentOnly?: boolean;
}): Promise<EngageStats> {
  const dryRun = opts.dryRun === true;
  const cronMode = opts.cronMode !== false;
  const silentOnly = opts.silentOnly === true || xMarketingSilentOnly();
  const enterprise = xApiEnterpriseAccess();
  const budget = await resolveRunBudget({ cronMode });
  const rotation = cronMode ? await bumpEngageRotation() : 0;

  const stats: EngageStats = {
    likes: 0,
    retweets: 0,
    follows: 0,
    replies: 0,
    quotes: 0,
    skipped403: 0,
    scanned: [],
    errors: [],
    rateLimited: false,
    cronMode,
    budget,
    silentOnly,
    apiTier: enterprise ? "enterprise" : "ppu",
  };

  if (!budget.allowed) {
    stats.skippedReason = budget.reason;
    return stats;
  }

  const engagedIds = dryRun ? new Set<string>() : await getRepliedTweetIds();

  let likeCap = budget.likes;
  let followCap = budget.follows;
  let rtCap = silentOnly ? 0 : budget.retweets;
  const allowVisibleEngage = !silentOnly && enterprise;
  let visibleCap = allowVisibleEngage ? budget.replies : 0;
  const visibleMaxPerRun = allowVisibleEngage ? (cronMode ? 1 : 2) : 0;

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

  async function tryQuote(tweet: XTweet, username: string): Promise<boolean> {
    if (!allowVisibleEngage || visibleCap <= 0 || stats.rateLimited) return false;
    if (engagedIds.has(tweet.id)) return false;
    const text = pickEngagementQuote(username, tweet.text ?? "").slice(0, 280);
    if (text.length < 20) return false;

    if (dryRun) {
      stats.quotes += 1;
      visibleCap -= 1;
      return true;
    }

    try {
      await postQuoteTweet(text, tweet.id);
      await markTweetReplied(tweet.id);
      await recordBudgetUse("replies");
      stats.quotes += 1;
      visibleCap -= 1;
      engagedIds.add(tweet.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "quote failed";
      if (isSelfServeApiBlock(msg)) {
        stats.skipped403 += 1;
        return false;
      }
      if (msg.includes("429") || msg.includes("rate limited")) {
        await handleRateLimited(stats);
        return false;
      }
      stats.errors.push(`quote:${username}:${msg.slice(0, 80)}`);
      return false;
    }
    await sleep(engagementJitterMs());
    return true;
  }

  async function tryReply(tweet: XTweet, username: string): Promise<boolean> {
    if (!allowVisibleEngage || visibleCap <= 0 || stats.rateLimited) return false;
    if (engagedIds.has(tweet.id)) return false;
    const text = pickEngagementReply(username, tweet.text ?? "").slice(0, 280);
    if (text.length < 25) return false;

    if (dryRun) {
      stats.replies += 1;
      visibleCap -= 1;
      return true;
    }

    try {
      await postReply(text, tweet.id);
      await markTweetReplied(tweet.id);
      await recordBudgetUse("replies");
      stats.replies += 1;
      visibleCap -= 1;
      engagedIds.add(tweet.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "reply failed";
      if (isSelfServeApiBlock(msg)) {
        stats.skipped403 += 1;
        return false;
      }
      if (msg.includes("429") || msg.includes("rate limited")) {
        await handleRateLimited(stats);
        return false;
      }
      stats.errors.push(`reply:${username}:${msg.slice(0, 80)}`);
      return false;
    }
    await sleep(engagementJitterMs());
    return true;
  }

  async function tryVisibleEngage(
    tweet: XTweet,
    username: string,
  ): Promise<boolean> {
    if (!allowVisibleEngage || !isEngagementTarget(username)) return false;
    if (stats.quotes + stats.replies >= visibleMaxPerRun) return false;
    if (await tryQuote(tweet, username)) return true;
    return tryReply(tweet, username);
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

    const tweets = await fetchUserTweets(user.id, 5);
    if (likeCap > 0) {
      for (const t of tweets) {
        if (!isReplyableTweet(t.text ?? "")) continue;
        if (!(await tryLike(t.id))) break;
      }
    }

    if (followCap > 0) {
      await tryFollow(user.id, user.username);
    }

    const visibleTweet = pickVisibleEngageTweet(tweets);
    if (visibleTweet && visibleCap > 0) {
      await tryVisibleEngage(visibleTweet, user.username);
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
    }
  }

  return stats;
}
