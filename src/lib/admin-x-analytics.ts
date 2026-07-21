import { xApiEnabled } from "@/lib/x-api";
import { topPerformingHooks } from "@/lib/x-analytics";
import {
  getLatestAnalytics,
  getAnalyticsHistory,
  type XAnalyticsSnapshot,
} from "@/lib/x-marketing-meta";
import {
  X_DAILY_CAPS,
  getDayBudgetSnapshot,
  isRateLimitPaused,
} from "@/lib/x-rate-budget";
import { dbConfigured, fetchCronJobLastRuns, type CronJobRunRow } from "@/lib/db";

const X_CRON_KEYS = ["x-autopost", "x-growth", "x-replies", "x-analytics"] as const;

export type XRecentTweetRow = XAnalyticsSnapshot["recent_tweets"][number] & {
  engagement_score: number;
};

export type XCronRunSummary = {
  job_key: string;
  status: string;
  started_at: string;
  message: string;
  likes?: number;
  follows?: number;
  replies?: number;
  quotes?: number;
  skipped403?: number;
  postType?: string;
  tweetId?: string;
};

export type XAdminAnalytics = {
  x_api_configured: boolean;
  snapshot_at: string | null;
  followers: number;
  following: number;
  tweet_count: number;
  follower_delta: number | null;
  avg_impressions: number;
  avg_likes: number;
  best_post: XRecentTweetRow | null;
  recent_posts: XRecentTweetRow[];
  budget_today: {
    date: string;
    likes: number;
    follows: number;
    replies: number;
    retweets: number;
    posts: number;
    caps: typeof X_DAILY_CAPS;
  };
  rate_limit_paused: boolean;
  rate_limit_until: string | null;
  crons: XCronRunSummary[];
  follower_history: Array<{ at: string; followers: number }>;
  insights: string[];
};

export function tweetEngagementScore(t: {
  likes: number;
  replies: number;
  retweets: number;
  impressions: number;
}): number {
  return (
    t.likes + t.replies * 2 + t.retweets * 3 + Math.round(t.impressions / 100)
  );
}

function withScores(
  tweets: XAnalyticsSnapshot["recent_tweets"],
): XRecentTweetRow[] {
  return tweets.map((t) => ({
    ...t,
    engagement_score: tweetEngagementScore(t),
  }));
}

function followerDelta(
  latest: XAnalyticsSnapshot | null,
  history: XAnalyticsSnapshot[],
): number | null {
  if (!latest) return null;
  const dayAgo = Date.now() - 24 * 3_600_000;
  const prior = [...history]
    .reverse()
    .find((h) => new Date(h.at).getTime() <= dayAgo);
  if (!prior) return null;
  return latest.followers - prior.followers;
}

function summarizeCronRun(row: CronJobRunRow): XCronRunSummary {
  const meta =
    row.meta_json && typeof row.meta_json === "object"
      ? (row.meta_json as Record<string, unknown>)
      : {};
  const num = (k: string) => {
    const v = meta[k];
    return typeof v === "number" ? v : undefined;
  };
  const str = (k: string) => {
    const v = meta[k];
    return typeof v === "string" ? v : undefined;
  };
  return {
    job_key: row.job_key,
    status: row.status,
    started_at: row.started_at,
    message: row.message ?? "",
    likes: num("likes"),
    follows: num("follows"),
    replies: num("replies"),
    quotes: num("quotes"),
    skipped403: num("skipped403"),
    postType: str("postType"),
    tweetId: str("tweetId"),
  };
}

function buildInsights(input: {
  snap: XAnalyticsSnapshot | null;
  avgImpressions: number;
  avgLikes: number;
  paused: boolean;
  budget: {
    posts: number;
    caps: typeof X_DAILY_CAPS;
  };
  crons: XCronRunSummary[];
}): string[] {
  const lines: string[] = [];
  if (!input.snap) {
    lines.push("No analytics snapshot yet — x-analytics cron runs daily ~7:30pm ET.");
    return lines;
  }
  if (input.avgImpressions < 100) {
    lines.push(
      `Reach is cold — recent posts avg ${Math.round(input.avgImpressions)} impressions.`,
    );
  }
  if (input.avgLikes < 1) {
    lines.push("Engagement is thin — desk posts with live desk card PNG + question hooks help most.");
  }
  if (input.paused) {
    lines.push("X write actions paused after rate limit — crons will skip until window clears.");
  }
  const growth = input.crons.find((c) => c.job_key === "x-growth");
  if (growth?.skipped403 && growth.skipped403 > 0) {
    lines.push(
      "Growth skipped cold 403 blocks — quotes/replies only fire on followed FinTwit targets.",
    );
  }
  if (input.budget.posts >= input.budget.caps.posts) {
    lines.push("Daily desk post cap reached — autopost will skip until tomorrow ET.");
  }
  const hooks = topPerformingHooks(input.snap, 1);
  if (hooks[0]) {
    lines.push(`Top hook lately: "${hooks[0].slice(0, 80)}…"`);
  }
  return lines.slice(0, 5);
}

export async function fetchXAdminAnalytics(): Promise<XAdminAnalytics> {
  const [latest, history, budget, pause, cronRows] = await Promise.all([
    getLatestAnalytics(),
    getAnalyticsHistory(30),
    getDayBudgetSnapshot(),
    isRateLimitPaused(),
    dbConfigured() ? fetchCronJobLastRuns() : Promise.resolve([]),
  ]);

  const recent = latest?.recent_tweets ?? [];
  const scored = withScores(recent);
  const avgImpressions =
    recent.length > 0
      ? recent.reduce((s, t) => s + t.impressions, 0) / recent.length
      : 0;
  const avgLikes =
    recent.length > 0
      ? recent.reduce((s, t) => s + t.likes, 0) / recent.length
      : 0;
  const best =
    scored.length > 0
      ? [...scored].sort((a, b) => b.engagement_score - a.engagement_score)[0]!
      : null;

  const xCrons = cronRows
    .filter((r) => (X_CRON_KEYS as readonly string[]).includes(r.job_key))
    .map(summarizeCronRun)
    .sort((a, b) => a.job_key.localeCompare(b.job_key));

  for (const key of X_CRON_KEYS) {
    if (!xCrons.some((c) => c.job_key === key)) {
      xCrons.push({
        job_key: key,
        status: "unknown",
        started_at: "",
        message: "No run logged",
      });
    }
  }
  xCrons.sort((a, b) => a.job_key.localeCompare(b.job_key));

  return {
    x_api_configured: xApiEnabled(),
    snapshot_at: latest?.at ?? null,
    followers: latest?.followers ?? 0,
    following: latest?.following ?? 0,
    tweet_count: latest?.tweet_count ?? 0,
    follower_delta: followerDelta(latest, history),
    avg_impressions: avgImpressions,
    avg_likes: avgLikes,
    best_post: best,
    recent_posts: scored,
    budget_today: { ...budget, caps: X_DAILY_CAPS },
    rate_limit_paused: pause.paused,
    rate_limit_until: pause.until ?? null,
    crons: xCrons,
    follower_history: history.map((h) => ({
      at: h.at,
      followers: h.followers,
    })),
    insights: buildInsights({
      snap: latest,
      avgImpressions,
      avgLikes,
      paused: pause.paused,
      budget: { ...budget, caps: X_DAILY_CAPS },
      crons: xCrons,
    }),
  };
}
