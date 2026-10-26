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

export async function markTweetReplied(tweetId: string): Promise<void> {
  const set = await getRepliedTweetIds();
  set.add(tweetId);
  const arr = [...set].slice(-MAX_REPLIED);
  await writeMeta(REPLIED_KEY, JSON.stringify(arr));
}

export async function getRecentPostHooks(): Promise<string[]> {
  return parseJsonArray(await readMeta(HOOKS_KEY));
}

// Lock key for the read-modify-write below. Same shape/rationale as x-rate-budget.ts's
// BUDGET_WRITE_LOCK (round 111) and REPLIED_WRITE_LOCK above (round 112): one global key is
// deliberate — the critical section is a single load+save, not a per-hook lock, so a global
// key just serializes that, and contention is rare (recordPostHook has exactly one call site,
// x-autopost/route.ts's post-success path, so the only realistic interleaving is two overlapping
// invocations of that SAME route — e.g. two manual `?force=1` triggers, or a manual run racing a
// re-enabled scheduled fire — not the cross-cron races REPLIED_WRITE_LOCK/BUDGET_WRITE_LOCK guard
// against. Still a real lost-update shape, so it gets the same fix.
const HOOKS_WRITE_LOCK = "x-marketing-recent-hooks-write";
const HOOKS_LOCK_MAX_ATTEMPTS = 30;
const HOOKS_LOCK_RETRY_MS = 60;

/**
 * Record a posted tweet's first line (its "hook") so `x-content-dedup.ts`'s
 * `getRecentPostHooks()` can steer future generations away from near-duplicate content.
 *
 * MUST be atomic across processes for the same reason `markTweetReplied` above is: this is an
 * unlocked read-modify-write (`getRecentPostHooks()` then `writeMeta()`, two separate Postgres
 * round-trips) against the shared `HOOKS_KEY` row. Two overlapping `recordPostHook` calls can
 * both read the same base array before either writes, so the second write clobbers the first
 * and one hook is silently dropped — the content-similarity dedup hint loses an entry it should
 * have, which weakens (not disables) the near-duplicate check the next post runs. Lower stakes
 * than the REPLIED_KEY race (a dropped hook doesn't cause a duplicate PUBLIC action by itself,
 * just a weaker dedup signal), but the same real correctness bug. Serialize the critical section
 * with the same `tryAdvisoryLock`/`releaseAdvisoryLock` primitive, same bounded retry.
 */
export async function recordPostHook(body: string): Promise<void> {
  const hook = body.trim().slice(0, 200);
  if (!hook) return;
  for (let attempt = 0; attempt < HOOKS_LOCK_MAX_ATTEMPTS; attempt += 1) {
    const acquired = await tryAdvisoryLock(HOOKS_WRITE_LOCK);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, HOOKS_LOCK_RETRY_MS));
      continue;
    }
    try {
      const prev = await getRecentPostHooks();
      prev.push(hook);
      await writeMeta(HOOKS_KEY, JSON.stringify(prev.slice(-MAX_HOOKS)));
    } finally {
      await releaseAdvisoryLock(HOOKS_WRITE_LOCK);
    }
    return;
  }
  // Could not get the lock after bounded retries (e.g. a stuck holder) — fall back to the old
  // unlocked behavior rather than silently dropping this hook forever. Worse than the locked
  // path, but no worse than before this fix, and logged so it's visible if it ever fires.
  console.warn(
    `[x-marketing-meta] could not acquire ${HOOKS_WRITE_LOCK} after ${HOOKS_LOCK_MAX_ATTEMPTS} attempts — recording hook unlocked`,
  );
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

// Lock key for the read-modify-write below. Same shape/rationale as HOOKS_WRITE_LOCK above and
// x-rate-budget.ts's BUDGET_WRITE_LOCK (round 111): the critical section is a single
// load+append+save against the shared ANALYTICS_HISTORY_KEY row, not a per-snapshot lock, so a
// global key just serializes that. x-analytics is a once-daily cron (cron-registry.ts,
// `30 23 * * *`), but it is NOT the only caller of collectXAnalyticsSnapshot/saveAnalyticsSnapshot
// — scripts/x-marketing-audit.mjs hits `GET /api/cron/x-analytics` (no `?dry=1`) directly against
// the SAME cron-authorized route to pull a fresh snapshot for its own audit output, so a manual
// audit run overlapping the scheduled fire (or two overlapping manual audit runs) is a real,
// demonstrated interleaving, not a hypothetical one.
const ANALYTICS_HISTORY_WRITE_LOCK = "x-marketing-analytics-history-write";
const ANALYTICS_HISTORY_LOCK_MAX_ATTEMPTS = 30;
const ANALYTICS_HISTORY_LOCK_RETRY_MS = 60;

function parseAnalyticsHistory(raw: string | null): XAnalyticsSnapshot[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as XAnalyticsSnapshot[]) : [];
  } catch {
    return [];
  }
}

/**
 * Save the latest X analytics snapshot + append it to the rolling history.
 *
 * The `ANALYTICS_KEY` ("latest") write is a pure overwrite — it never depends on the prior
 * value, so it needs no lock. The `ANALYTICS_HISTORY_KEY` append is a genuine unlocked
 * read-modify-write (`readMeta` then `writeMeta`, two separate Postgres round-trips): two
 * overlapping calls can both read the same base history array before either writes, so the
 * second write clobbers the first and one whole snapshot is silently dropped from history —
 * the classic lost-update shape already fixed for `recordPostHook`/`recordBudgetUse` in this
 * codebase. Lower stakes than those (history is a trend/debugging aid, not a safety budget),
 * but the same real correctness bug, so it gets the same `tryAdvisoryLock`/`releaseAdvisoryLock`
 * serialization with a short bounded retry.
 */
export async function saveAnalyticsSnapshot(
  snap: XAnalyticsSnapshot,
): Promise<void> {
  await writeMeta(ANALYTICS_KEY, JSON.stringify(snap));

  for (let attempt = 0; attempt < ANALYTICS_HISTORY_LOCK_MAX_ATTEMPTS; attempt += 1) {
    const acquired = await tryAdvisoryLock(ANALYTICS_HISTORY_WRITE_LOCK);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, ANALYTICS_HISTORY_LOCK_RETRY_MS));
      continue;
    }
    try {
      const history = parseAnalyticsHistory(await readMeta(ANALYTICS_HISTORY_KEY));
      history.push(snap);
      await writeMeta(
        ANALYTICS_HISTORY_KEY,
        JSON.stringify(history.slice(-MAX_HISTORY)),
      );
    } finally {
      await releaseAdvisoryLock(ANALYTICS_HISTORY_WRITE_LOCK);
    }
    return;
  }
  // Could not get the lock after bounded retries (e.g. a stuck holder) — fall back to the old
  // unlocked behavior rather than silently dropping this snapshot forever. Worse than the
  // locked path, but no worse than before this fix, and logged so it's visible if it ever fires.
  console.warn(
    `[x-marketing-meta] could not acquire ${ANALYTICS_HISTORY_WRITE_LOCK} after ${ANALYTICS_HISTORY_LOCK_MAX_ATTEMPTS} attempts — appending analytics history unlocked`,
  );
  const history = parseAnalyticsHistory(await readMeta(ANALYTICS_HISTORY_KEY));
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

// Lock key for the read-modify-write below. Same shape/rationale as BUDGET_WRITE_LOCK (round
// 111) and REPLIED_WRITE_LOCK (round 112): a DISTINCT global key per guarded field, so this
// critical section never serializes against the unrelated budget/replied-ids ones.
const ENGAGE_ROTATION_WRITE_LOCK = "x-marketing-engage-rotation-write";
const ENGAGE_ROTATION_LOCK_MAX_ATTEMPTS = 30;
const ENGAGE_ROTATION_LOCK_RETRY_MS = 60;

/**
 * Advance the engagement target-rotation index and return the new value.
 *
 * MUST be atomic across processes: `x-growth` and `x-engage` are SEPARATE cron routes that
 * both call `runEngagementSweep` (x-growth-engine.ts's `runGrowthSweep` is a thin wrapper
 * around the exact same function x-engage's route calls directly), and each call bumps this
 * SAME `ENGAGE_ROTATION_KEY` row once per sweep to rotate which engagement targets get
 * picked next. Before this fix, `getEngageRotationIndex()` (read) then `writeMeta()` (write)
 * were two separate, unlocked Postgres round-trips: if two processes interleave — both read
 * the same base value, both compute `base + 1`, both write — the second write clobbers the
 * first and one whole rotation step is silently lost (the same read-modify-write "lost
 * update" shape as `recordBudgetUse`/`markTweetReplied` before rounds 111/112's fixes).
 * Lower-stakes than those two (worst case is a repeated/skipped rotation offset, not a
 * double-spend or a duplicate public tweet), but the fix is identical and just as cheap:
 * serialize the critical section with the same `tryAdvisoryLock`/`releaseAdvisoryLock`
 * primitive, same short bounded retry (tryAdvisoryLock is non-blocking "try", not a queue —
 * the holder releases within one round-trip).
 */
export async function bumpEngageRotation(): Promise<number> {
  for (
    let attempt = 0;
    attempt < ENGAGE_ROTATION_LOCK_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const acquired = await tryAdvisoryLock(ENGAGE_ROTATION_WRITE_LOCK);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, ENGAGE_ROTATION_LOCK_RETRY_MS));
      continue;
    }
    try {
      const next = ((await getEngageRotationIndex()) + 1) % 1000;
      await writeMeta(ENGAGE_ROTATION_KEY, String(next));
      return next;
    } finally {
      await releaseAdvisoryLock(ENGAGE_ROTATION_WRITE_LOCK);
    }
  }
  // Could not get the lock after bounded retries (e.g. a stuck holder) — fall back to the old
  // unlocked behavior rather than stalling the rotation forever. Worse than the locked path,
  // but no worse than before this fix, and logged so it's visible if it ever fires.
  console.warn(
    `[x-marketing-meta] could not acquire ${ENGAGE_ROTATION_WRITE_LOCK} after ${ENGAGE_ROTATION_LOCK_MAX_ATTEMPTS} attempts — bumping engage rotation unlocked`,
  );
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
