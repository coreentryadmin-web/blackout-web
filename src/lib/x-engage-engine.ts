import {
  lookupUserByUsername,
  fetchUserTweets,
  searchRecentTweets,
  likeTweet,
  retweet,
  followUser,
  postTweet,
  X_BLOCK_RT_USERNAMES,
  type XTweetSearchHit,
} from "@/lib/x-api";
import {
  ENGAGEMENT_TARGETS,
  SEARCH_QUERIES,
  ENGAGE_LIMITS,
  MAX_TWEET_AGE_HOURS,
  MIN_IMPRESSIONS_FOR_REPLY,
} from "@/lib/x-engage-config";
import { isReplyableTweet } from "@/lib/x-engage-replies";

export interface EngageStats {
  likes: number;
  replies: number;
  retweets: number;
  follows: number;
  mentionPosts: number;
  scanned: string[];
  mentionPosted: string[];
  errors: string[];
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
  const replies = t.public_metrics?.reply_count ?? 99;
  let score = 0;
  if (imps >= MIN_IMPRESSIONS_FOR_REPLY) score += 3;
  if (imps >= 100) score += 2;
  if (replies < 15) score += 2;
  if (tweetAgeHours(t.created_at) < 2) score += 2;
  return score;
}

/** Original tweet @mentioning someone — allowed on Basic tier (not a reply). */
export function buildMentionOutreachTweet(
  username: string,
  tweetText: string,
): string {
  const u = `@${username.replace(/^@/, "")}`;
  const lower = tweetText.toLowerCase();
  if (/0dte|gamma|gex|dealer|flip|wall/.test(lower)) {
    return `${u} Solid read — flip + dealer gamma usually confirm or kill these setups. What's your level on SPX today?`.slice(
      0,
      280,
    );
  }
  return `${u} Good thread — positioning data (gamma walls + flip) usually tells the real story. What ticker are you trading?`.slice(
    0,
    280,
  );
}

async function tryLike(
  tweetId: string,
  stats: EngageStats,
  dryRun: boolean,
): Promise<void> {
  if (stats.likes >= ENGAGE_LIMITS.likes) return;
  if (dryRun) {
    stats.likes += 1;
    return;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await likeTweet(tweetId);
    if (ok) {
      stats.likes += 1;
      break;
    }
    await sleep(ENGAGE_LIMITS.delayMs * (attempt + 2));
  }
  await sleep(ENGAGE_LIMITS.delayMs);
}

export async function runEngagementSweep(opts: {
  dryRun?: boolean;
}): Promise<EngageStats> {
  const dryRun = opts.dryRun === true;
  const stats: EngageStats = {
    likes: 0,
    replies: 0,
    retweets: 0,
    follows: 0,
    mentionPosts: 0,
    scanned: [],
    mentionPosted: [],
    errors: [],
  };
  const mentionPostedUsers = new Set<string>();

  // Phase 1 — FinTwit: follow + like + RT (replies blocked on Basic tier unless @mentioned)
  for (const handle of ENGAGEMENT_TARGETS) {
    if (
      stats.follows >= ENGAGE_LIMITS.follows &&
      stats.likes >= ENGAGE_LIMITS.likes
    ) {
      break;
    }
    if (X_BLOCK_RT_USERNAMES.has(handle)) continue;

    const user = await lookupUserByUsername(handle);
    if (!user) {
      stats.errors.push(`lookup:${handle}`);
      await sleep(ENGAGE_LIMITS.delayMs);
      continue;
    }
    stats.scanned.push(`@${user.username}`);

    if (stats.follows < ENGAGE_LIMITS.follows) {
      if (!dryRun) {
        const ok = await followUser(user.id);
        if (ok) stats.follows += 1;
      } else {
        stats.follows += 1;
      }
      await sleep(ENGAGE_LIMITS.delayMs);
    }

    const tweets = await fetchUserTweets(user.id, 5);
    for (const t of tweets) {
      if (!isReplyableTweet(t.text)) continue;
      await tryLike(t.id, stats, dryRun);

      if (
        stats.retweets < ENGAGE_LIMITS.retweets &&
        /\$|\d{3,}|million|whale|gamma|0dte/.test(t.text.toLowerCase())
      ) {
        if (!dryRun) {
          const rt = await retweet(t.id);
          if (rt) stats.retweets += 1;
          else stats.errors.push(`rt:${t.id}`);
        } else {
          stats.retweets += 1;
        }
        await sleep(ENGAGE_LIMITS.delayMs);
      }
    }

    // Original @mention tweet (not a reply) — surfaces in their notifications
    if (
      stats.mentionPosts < ENGAGE_LIMITS.mentionPosts &&
      !mentionPostedUsers.has(user.username.toLowerCase()) &&
      tweets[0]
    ) {
      const text = buildMentionOutreachTweet(user.username, tweets[0].text);
      if (!dryRun) {
        try {
          await postTweet(text);
          stats.mentionPosts += 1;
          stats.mentionPosted.push(user.username);
          mentionPostedUsers.add(user.username.toLowerCase());
        } catch (e) {
          stats.errors.push(
            `mention:${user.username}:${e instanceof Error ? e.message : "fail"}`,
          );
        }
      } else {
        stats.mentionPosts += 1;
        stats.mentionPosted.push(user.username);
      }
      await sleep(ENGAGE_LIMITS.delayMs * 2);
    }
  }

  // Phase 2 — Search: like + RT hot niche tweets
  const candidates: XTweetSearchHit[] = [];
  for (const query of SEARCH_QUERIES) {
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

  for (const t of candidates) {
    if (stats.likes >= ENGAGE_LIMITS.likes && stats.retweets >= ENGAGE_LIMITS.retweets) {
      break;
    }
    const user = t.author_username!;
    stats.scanned.push(`search:@${user}`);
    await tryLike(t.id, stats, dryRun);

    if (stats.follows < ENGAGE_LIMITS.follows && t.author_id) {
      if (!dryRun) {
        const ok = await followUser(t.author_id);
        if (ok) stats.follows += 1;
      } else {
        stats.follows += 1;
      }
      await sleep(ENGAGE_LIMITS.delayMs);
    }
  }

  return stats;
}
