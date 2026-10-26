import { getMeta, setMeta, tryAdvisoryLock, releaseAdvisoryLock } from "@/lib/db";
import { isWsUpdatedAtFresh } from "@/lib/ws/timestamp-freshness";

const REPLIED_KEY = "x_marketing_replied_ids";
const HOOKS_KEY = "x_marketing_recent_hooks";
const ANALYTICS_KEY = "x_marketing_analytics_latest";
const ANALYTICS_HISTORY_KEY = "x_marketing_analytics_history";
const ENGAGE_ROTATION_KEY = "x_marketing_engage_rotation";

const memoryMeta = new Map<string, string>();

async function readMeta(key: string): Promise<string | null> {
  try {
    return await getMeta(key);
  } catch {
    return memoryMeta.get(key) ?? null;
  }
}

async function writeMeta(key: string, value: string): Promise<void> {
  try {
    await setMeta(key, value);
  } catch {
    if (value === "") memoryMeta.delete(key);
    else memoryMeta.set(key, value);
  }
}

const MAX_REPLIED = 500;
const MAX_HOOKS = 30;
const MAX_HISTORY = 90;

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function getRepliedTweetIds(): Promise<Set<string>> {
  const ids = parseJsonArray(await readMeta(REPLIED_KEY));
  return new Set(ids);
}

// Lock key for the read-modify-write below. Same shape/rationale as x-rate-budget.ts's
// BUDGET_WRITE_LOCK (round 111): one global key is deliberate — contention is already rare
// (actions are jittered 2-4.5s apart per caller, see engagementJitterMs), and the critical
// section is a single load+save, not a per-tweet lock, so a global key just serializes that.
const REPLIED_WRITE_LOCK = "x-marketing-replied-ids-write";
const REPLIED_LOCK_MAX_ATTEMPTS = 30;
const REPLIED_LOCK_RETRY_MS = 60;

/**
 * Record that we've already replied to / quote-tweeted a tweet.
 *
 * MUST be atomic across processes: `x-growth` and `x-engage` are SEPARATE cron routes that
 * both call `runEngagementSweep` (x-growth-engine.ts's `runGrowthSweep` is a thin wrapper
 * around the exact same function x-engage's route calls directly), and `x-replies`
 * (x-mention-replies.ts) calls this too — all three read/write the SAME `REPLIED_KEY` row.
 * Before this fix, `getRepliedTweetIds()` (read) then `writeMeta()` (write) were two
 * separate, unlocked Postgres round-trips: if two processes interleave — both read the same
 * base set, each adds its OWN tweet id, both write — the second write clobbers the first and
 * the first caller's tweet id is silently dropped from the dedup set (a classic
 * read-modify-write "lost update", same shape as recordBudgetUse before round 111's fix).
 * Unlike the budget counter (which only undercounts a soft cap), losing an id here means a
 * LATER run no longer sees that tweet as already-replied-to and can reply or quote-tweet it
 * AGAIN — a visible, public duplicate action from the brand account, not just a bookkeeping
 * drift. Serialize the critical section with the same `tryAdvisoryLock`/`releaseAdvisoryLock`
 * primitive `recordBudgetUse` uses, with the same short bounded retry (tryAdvisoryLock is
 * non-blocking "try", not a queue — the holder releases within one round-trip).
 */
export async function markTweetReplied(tweetId: string): Promise<void> {
  for (let attempt = 0; attempt < REPLIED_LOCK_MAX_ATTEMPTS; attempt += 1) {
    const acquired = await tryAdvisoryLock(REPLIED_WRITE_LOCK);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, REPLIED_LOCK_RETRY_MS));
      continue;
    }
    try {
      const set = await getRepliedTweetIds();
      set.add(tweetId);
      const arr = [...set].slice(-MAX_REPLIED);
      await writeMeta(REPLIED_KEY, JSON.stringify(arr));
    } finally {
      await releaseAdvisoryLock(REPLIED_WRITE_LOCK);
    }
    return;
  }
  // Could not get the lock after bounded retries (e.g. a stuck holder) — fall back to the old
  // unlocked behavior rather than silently dropping this tweet id forever. Worse than the
  // locked path, but no worse than before this fix, and logged so it's visible if it ever fires.
  console.warn(
    `[x-marketing-meta] could not acquire ${REPLIED_WRITE_LOCK} after ${REPLIED_LOCK_MAX_ATTEMPTS} attempts — marking ${tweetId} replied unlocked`,
  );
  const set = await getRepliedTweetIds();
  set.add(tweetId);
  const arr = [...set].slice(-MAX_REPLIED);
  await writeMeta(REPLIED_KEY, JSON.stringify(arr));
}

export async function getRecentPostHooks(): Promise<string[]> {
  return parseJsonArray(await readMeta(HOOKS_KEY));
}

export async function recordPostHook(body: string): Promise<void> {
  const hook = body.trim().slice(0, 200);
  if (!hook) return;
  const prev = await getRecentPostHooks();
  prev.push(hook);
  await writeMeta(HOOKS_KEY, JSON.stringify(prev.slice(-MAX_HOOKS)));
}

export interface XAnalyticsSnapshot {
  at: string;
  followers: number;
  following: number;
  tweet_count: number;
  recent_tweets: Array<{
    id: string;
    text: string;
    likes: number;
    replies: number;
    retweets: number;
    impressions: number;
  }>;
}

export async function saveAnalyticsSnapshot(
  snap: XAnalyticsSnapshot,
): Promise<void> {
  await writeMeta(ANALYTICS_KEY, JSON.stringify(snap));
  const raw = await readMeta(ANALYTICS_HISTORY_KEY);
  let history: XAnalyticsSnapshot[] = [];
  try {
    history = raw ? (JSON.parse(raw) as XAnalyticsSnapshot[]) : [];
  } catch {
    history = [];
  }
  history.push(snap);
  await writeMeta(
    ANALYTICS_HISTORY_KEY,
    JSON.stringify(history.slice(-MAX_HISTORY)),
  );
}

export async function getLatestAnalytics(): Promise<XAnalyticsSnapshot | null> {
  const raw = await readMeta(ANALYTICS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as XAnalyticsSnapshot;
  } catch {
    return null;
  }
}

export async function getAnalyticsHistory(limit = 30): Promise<XAnalyticsSnapshot[]> {
  const raw = await readMeta(ANALYTICS_HISTORY_KEY);
  if (!raw) return [];
  try {
    const history = JSON.parse(raw) as XAnalyticsSnapshot[];
    return history.slice(-limit);
  } catch {
    return [];
  }
}

export async function getEngageRotationIndex(): Promise<number> {
  const raw = await readMeta(ENGAGE_ROTATION_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function bumpEngageRotation(): Promise<number> {
  const next = ((await getEngageRotationIndex()) + 1) % 1000;
  await writeMeta(ENGAGE_ROTATION_KEY, String(next));
  return next;
}

const FOLLOWING_CACHE_KEY = "x_marketing_following_ids_cache";
const FOLLOWING_CACHE_MS = 60 * 60 * 1000;

/** Cached set of user IDs @BlackOutTrade already follows (refreshed hourly). */
export async function getCachedFollowingUserIds(
  refresh: () => Promise<Set<string>>,
): Promise<Set<string>> {
  const raw = await readMeta(FOLLOWING_CACHE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { at?: number; ids?: string[] };
      if (
        parsed.at &&
        isWsUpdatedAtFresh(parsed.at, FOLLOWING_CACHE_MS) &&
        Array.isArray(parsed.ids)
      ) {
        return new Set(parsed.ids);
      }
    } catch {
      /* refresh below */
    }
  }
  const ids = await refresh();
  await writeMeta(
    FOLLOWING_CACHE_KEY,
    JSON.stringify({ at: Date.now(), ids: [...ids] }),
  );
  return ids;
}

export async function invalidateFollowingCache(): Promise<void> {
  await writeMeta(FOLLOWING_CACHE_KEY, "");
}
