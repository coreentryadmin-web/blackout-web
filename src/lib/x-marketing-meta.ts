import { getMeta, setMeta } from "@/lib/db";

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
