import {
  fetchOwnAccountMetrics,
  fetchUserTweets,
  X_ACCOUNT_USER_ID,
} from "@/lib/x-api";
import {
  saveAnalyticsSnapshot,
  type XAnalyticsSnapshot,
} from "@/lib/x-marketing-meta";

export async function collectXAnalyticsSnapshot(): Promise<XAnalyticsSnapshot> {
  const [account, tweets] = await Promise.all([
    fetchOwnAccountMetrics(),
    fetchUserTweets(X_ACCOUNT_USER_ID, 10),
  ]);

  const snap: XAnalyticsSnapshot = {
    at: new Date().toISOString(),
    followers: account?.followers ?? 0,
    following: account?.following ?? 0,
    tweet_count: account?.tweet_count ?? 0,
    recent_tweets: tweets.map((t) => ({
      id: t.id,
      text: (t.text ?? "").slice(0, 120),
      likes: t.public_metrics?.like_count ?? 0,
      replies: t.public_metrics?.reply_count ?? 0,
      retweets: t.public_metrics?.retweet_count ?? 0,
      impressions: t.public_metrics?.impression_count ?? 0,
    })),
  };

  await saveAnalyticsSnapshot(snap);
  return snap;
}

/** Top-performing recent tweet hooks for prompt tuning. */
export function topPerformingHooks(
  snap: XAnalyticsSnapshot,
  limit = 3,
): string[] {
  return [...snap.recent_tweets]
    .sort(
      (a, b) =>
        b.likes +
        b.replies * 2 +
        b.retweets * 3 +
        b.impressions / 100 -
        (a.likes + a.replies * 2 + a.retweets * 3 + a.impressions / 100),
    )
    .slice(0, limit)
    .map((t) => t.text);
}
