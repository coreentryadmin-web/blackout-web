import { getMeta, setMeta, tryAdvisoryLock, releaseAdvisoryLock } from "@/lib/db";
import { xGrowthIntensive } from "@/lib/x-marketing-env";

/** Conservative caps — stay under pay-per-use spend + 429 thresholds. */
export const X_DAILY_CAPS = {
  likes: 48,
  follows: 12,
  replies: 24,
  retweets: 2,
  posts: 7,
} as const;

/** Per scheduled cron invocation (x-growth every ~30 min when intensive). */
export const X_CRON_RUN_CAPS = {
  likes: 3,
  follows: 1,
  replies: 2,
  retweets: 0,
} as const;

/** X_GROWTH_INTENSIVE=1 — larger batches within same daily caps. */
export const X_INTENSIVE_CRON_RUN_CAPS = {
  likes: 4,
  follows: 2,
  replies: 0,
  retweets: 1,
} as const;

/** Manual `npm run x-marketing:run` — still bounded. */
export const X_MANUAL_RUN_CAPS = {
  likes: 12,
  follows: 4,
  replies: 5,
  retweets: 1,
} as const;

const PAUSE_KEY = "x_marketing_rate_pause_until";
const BUDGET_PREFIX = "x_marketing_budget_";

export type XBudgetAction = "likes" | "follows" | "replies" | "retweets" | "posts";

interface DayBudget {
  date: string;
  likes: number;
  follows: number;
  replies: number;
  retweets: number;
  posts: number;
}

function todayEt(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

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

async function loadDayBudget(): Promise<DayBudget> {
  const date = todayEt();
  const raw = await readMeta(`${BUDGET_PREFIX}${date}`);
  if (!raw) {
    return {
      date,
      likes: 0,
      follows: 0,
      replies: 0,
      retweets: 0,
      posts: 0,
    };
  }
  try {
    const parsed = JSON.parse(raw) as DayBudget;
    return parsed.date === date ? parsed : { date, likes: 0, follows: 0, replies: 0, retweets: 0, posts: 0 };
  } catch {
    return { date, likes: 0, follows: 0, replies: 0, retweets: 0, posts: 0 };
  }
}

async function saveDayBudget(b: DayBudget): Promise<void> {
  await writeMeta(`${BUDGET_PREFIX}${b.date}`, JSON.stringify(b));
}

export async function isRateLimitPaused(): Promise<{
  paused: boolean;
  until?: string;
}> {
  const raw = await readMeta(PAUSE_KEY);
  if (!raw) return { paused: false };
  const until = parseInt(raw, 10);
  if (!Number.isFinite(until) || Date.now() >= until) {
    await writeMeta(PAUSE_KEY, "");
    return { paused: false };
  }
  return { paused: true, until: new Date(until).toISOString() };
}

/** Pause all X write actions after a 429 (default 15 min). */
export async function pauseForRateLimit(ms = 15 * 60_000): Promise<void> {
  await writeMeta(PAUSE_KEY, String(Date.now() + ms));
}

export async function remainingDaily(
  action: XBudgetAction,
): Promise<number> {
  const b = await loadDayBudget();
  const used = b[action];
  return Math.max(0, X_DAILY_CAPS[action] - used);
}

/** ET-day budget usage for admin dashboard. */
export async function getDayBudgetSnapshot(): Promise<DayBudget> {
  return loadDayBudget();
}

export interface RunBudget {
  allowed: boolean;
  reason?: string;
  likes: number;
  follows: number;
  replies: number;
  retweets: number;
  pauseUntil?: string;
}

/** Resolve how many actions this run may take (daily + per-run caps). */
export async function resolveRunBudget(opts: {
  cronMode?: boolean;
}): Promise<RunBudget> {
  const pause = await isRateLimitPaused();
  if (pause.paused) {
    return {
      allowed: false,
      reason: `Rate-limit pause until ${pause.until}`,
      likes: 0,
      follows: 0,
      replies: 0,
      retweets: 0,
      pauseUntil: pause.until,
    };
  }

  const perRun = opts.cronMode
    ? xGrowthIntensive()
      ? X_INTENSIVE_CRON_RUN_CAPS
      : X_CRON_RUN_CAPS
    : X_MANUAL_RUN_CAPS;
  const b = await loadDayBudget();

  const likes = Math.min(
    perRun.likes,
    Math.max(0, X_DAILY_CAPS.likes - b.likes),
  );
  const follows = Math.min(
    perRun.follows,
    Math.max(0, X_DAILY_CAPS.follows - b.follows),
  );
  const replies = Math.min(
    perRun.replies,
    Math.max(0, X_DAILY_CAPS.replies - b.replies),
  );
  const retweets = Math.min(
    perRun.retweets,
    Math.max(0, X_DAILY_CAPS.retweets - b.retweets),
  );

  if (likes + follows + replies + retweets === 0) {
    return {
      allowed: false,
      reason: "Daily X API budget exhausted",
      likes: 0,
      follows: 0,
      replies: 0,
      retweets: 0,
    };
  }

  return { allowed: true, likes, follows, replies, retweets };
}

// Lock key for the read-modify-write below. One global key (not per-day) is deliberate: the
// day rolls over mid-lock-window otherwise would need its own coordination, and contention is
// already rare (actions are jittered 2-4.5s apart per caller — see engagementJitterMs).
const BUDGET_WRITE_LOCK = "x-marketing-budget-write";
const BUDGET_LOCK_MAX_ATTEMPTS = 30;
const BUDGET_LOCK_RETRY_MS = 60;

/**
 * Increment one of today's X-action counters.
 *
 * MUST be atomic across processes: x-growth and x-engage are SEPARATE cron routes
 * (x-growth-engine.ts's runGrowthSweep is a thin wrapper around runEngagementSweep — the
 * SAME function x-engage's route calls directly) that can run concurrently, and
 * x-autopost/x-mention-replies also call this against the same per-day row. Before this fix,
 * `loadDayBudget()` (read) then `saveDayBudget()` (write) were two separate, unlocked
 * Postgres round-trips: if two processes interleave — both read the same base value, both
 * add their own increment, both write — the SECOND write clobbers the first and one whole
 * action's usage is silently lost (a classic read-modify-write race, "lost update"). That
 * defeats the entire point of X_DAILY_CAPS ("stay under pay-per-use spend + 429 thresholds")
 * — the real X API calls still happened, only the recorded count undercounts them, so
 * `resolveRunBudget`/`remainingDaily` keep believing there is headroom that is already spent.
 * Serialize the critical section with the same `tryAdvisoryLock`/`releaseAdvisoryLock`
 * primitive other crons in this repo use for whole-run dedup (flow-ingest.ts,
 * welcome-sequence/route.ts, membership-reconcile/route.ts) — here scoped to just the
 * load+mutate+save, with a short bounded retry (tryAdvisoryLock is non-blocking "try", not a
 * queue) since the holder releases within one Postgres round-trip.
 */
export async function recordBudgetUse(
  action: XBudgetAction,
  count = 1,
): Promise<void> {
  for (let attempt = 0; attempt < BUDGET_LOCK_MAX_ATTEMPTS; attempt += 1) {
    const acquired = await tryAdvisoryLock(BUDGET_WRITE_LOCK);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, BUDGET_LOCK_RETRY_MS));
      continue;
    }
    try {
      const b = await loadDayBudget();
      b[action] += count;
      await saveDayBudget(b);
    } finally {
      await releaseAdvisoryLock(BUDGET_WRITE_LOCK);
    }
    return;
  }
  // Could not get the lock after bounded retries (e.g. a stuck holder) — fall back to the old
  // unlocked behavior rather than silently dropping this increment forever. Worse than the
  // locked path, but no worse than before this fix, and logged so it's visible if it ever fires.
  console.warn(
    `[x-rate-budget] could not acquire ${BUDGET_WRITE_LOCK} after ${BUDGET_LOCK_MAX_ATTEMPTS} attempts — recording ${action} unlocked`,
  );
  const b = await loadDayBudget();
  b[action] += count;
  await saveDayBudget(b);
}

/** Random delay 2–4.5s — avoids burst patterns that trigger 429. */
export function engagementJitterMs(): number {
  return 2000 + Math.floor(Math.random() * 2500);
}
