import {
  lookupUserByUsername,
  fetchUserTweets,
  searchRecentTweets,
  fetchFollowingUserIds,
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
  DISCOVERY_SEARCH_QUERIES,
  MAX_TWEET_AGE_HOURS,
  MIN_IMPRESSIONS_FOR_RT,
  MIN_IMPRESSIONS_FOR_RT_INTENSIVE,
  MIN_IMPRESSIONS_FOR_DISCOVERY_RT,
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
  getCachedFollowingUserIds,
  invalidateFollowingCache,
} from "@/lib/x-marketing-meta";
import {
  xApiEnterpriseAccess,
  xGrowthIntensive,
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
  /** New profiles followed via search discovery (not curated giants). */
  discoveryFollows: number;
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
  intensive?: boolean;
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
  const intensive = xGrowthIntensive();
  const budget = await resolveRunBudget({ cronMode });
  const rotation = await bumpEngageRotation();

  const stats: EngageStats = {
    likes: 0,
    retweets: 0,
    follows: 0,
    replies: 0,
    quotes: 0,
    skipped403: 0,
    discoveryFollows: 0,
    scanned: [],
    errors: [],
    rateLimited: false,
    cronMode,
    budget,
    silentOnly,
    apiTier: enterprise ? "enterprise" : "ppu",
    intensive,
  };

  if (!budget.allowed) {
    stats.skippedReason = budget.reason;
    return stats;
  }

  const engagedIds = dryRun ? new Set<string>() : await getRepliedTweetIds();

  let likeCap = budget.likes;
  let followCap = budget.follows;
  let rtCap = budget.retweets;
  const rtMinImps = intensive ? MIN_IMPRESSIONS_FOR_RT_INTENSIVE : MIN_IMPRESSIONS_FOR_RT;
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

  async function tryFollow(
    userId: string,
    label: string,
    discovery = false,
  ): Promise<boolean> {
    if (followCap <= 0 || stats.rateLimited) return false;
    if (dryRun) {
      stats.follows += 1;
      followCap -= 1;
      if (discovery) stats.discoveryFollows += 1;
      return true;
    }
    const result = await followUser(userId);
    if (result === "ok") {
      stats.follows += 1;
      followCap -= 1;
      await recordBudgetUse("follows");
      if (discovery) stats.discoveryFollows += 1;
      if (!dryRun) await invalidateFollowingCache();
    } else if (result === "rate_limited") {
      await handleRateLimited(stats);
      return false;
    } else if (result === "already_following") {
      /* skip — save follow budget for new giants */
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

  async function tryRetweet(tweetId: string, imps: number, minImps = rtMinImps): Promise<boolean> {
    if (rtCap <= 0 || stats.rateLimited) return false;
    if (imps < minImps) return false;
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

  const targetBatch = cronMode ? (intensive ? 4 : 2) : 5;
  const likesPerTarget = intensive ? 2 : 1;
  const targets = rotatedTargets(rotation, targetBatch);

  const followingIds = dryRun
    ? new Set<string>()
    : await getCachedFollowingUserIds(fetchFollowingUserIds);

  function isNewDiscoveryAuthor(hit: XTweetSearchHit): boolean {
    const username = hit.author_username?.replace(/^@/, "").toLowerCase();
    if (!username || !hit.author_id) return false;
    if (username === "blackouttrade") return false;
    if (isEngagementTarget(username)) return false;
    if (X_BLOCK_RT_USERNAMES.has(username)) return false;
    if (followingIds.has(hit.author_id)) return false;
    return true;
  }

  async function runDiscoveryPass(): Promise<void> {
    if (stats.rateLimited) return;
    if (followCap <= 0 && likeCap <= 0 && rtCap <= 0) return;

    const queryCount = cronMode ? 1 : 2;
    const seenAuthors = new Set<string>();

    for (let q = 0; q < queryCount; q += 1) {
      if (stats.rateLimited) break;
      const query =
        DISCOVERY_SEARCH_QUERIES[
          (rotation + q) % DISCOVERY_SEARCH_QUERIES.length
        ]!;
      const hits = await searchRecentTweets(query, cronMode ? 15 : 25);
      const candidates = hits
        .filter((h) => {
          if (!isNewDiscoveryAuthor(h)) return false;
          if (seenAuthors.has(h.author_id!)) return false;
          if (tweetAgeHours(h.created_at) > MAX_TWEET_AGE_HOURS) return false;
          return isReplyableTweet(h.text);
        })
        .sort((a, b) => scoreSearchHit(b) - scoreSearchHit(a));

      for (const t of candidates) {
        if (stats.rateLimited) break;
        if (followCap <= 0 && likeCap <= 0 && rtCap <= 0) break;
        const authorId = t.author_id!;
        seenAuthors.add(authorId);
        stats.scanned.push(`discover:@${t.author_username}`);

        if (likeCap > 0) await tryLike(t.id);

        if (followCap > 0) {
          const followed = await tryFollow(authorId, t.author_username!, true);
          if (followed) followingIds.add(authorId);
        }

        if (rtCap > 0) {
          const imps = t.public_metrics?.impression_count ?? 0;
          await tryRetweet(t.id, imps, MIN_IMPRESSIONS_FOR_DISCOVERY_RT);
        }
      }
    }
  }

  // 1) Discovery first — new FinTwit voices from search (follows only land here).
  await runDiscoveryPass();

  // 2) Curated giants — likes + selective RT only (skip follows; we're already following most).
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

    const tweets = await fetchUserTweets(user.id, 8);
    if (likeCap > 0) {
      let likedOnAccount = 0;
      for (const t of tweets) {
        if (likedOnAccount >= likesPerTarget) break;
        if (!isReplyableTweet(t.text ?? "")) continue;
        if (await tryLike(t.id)) likedOnAccount += 1;
      }
    }

    if (rtCap > 0) {
      for (const t of tweets) {
        const imps = t.public_metrics?.impression_count ?? 0;
        if (await tryRetweet(t.id, imps, rtMinImps)) break;
      }
    }

    const visibleTweet = pickVisibleEngageTweet(tweets);
    if (visibleTweet && visibleCap > 0) {
      await tryVisibleEngage(visibleTweet, user.username);
    }
  }

  // 3) Extra search likes on trending 0DTE posts (no follows — giants/search overlap).
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

    for (const t of candidates.slice(0, likeCap + (cronMode ? 1 : 2) + followCap)) {
      if (stats.rateLimited) break;
      stats.scanned.push(`search:@${t.author_username}`);
      if (!(await tryLike(t.id))) break;
      if (followCap > 0 && t.author_id && isNewDiscoveryAuthor(t)) {
        const followed = await tryFollow(t.author_id, t.author_username!, true);
        if (followed) followingIds.add(t.author_id);
      }
      const imps = t.public_metrics?.impression_count ?? 0;
      if (rtCap > 0) await tryRetweet(t.id, imps);
    }
  }

  return stats;
}
