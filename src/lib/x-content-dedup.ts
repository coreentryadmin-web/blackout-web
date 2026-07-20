import { fetchUserTweets, X_ACCOUNT_USER_ID } from "@/lib/x-api";
import { getRecentPostHooks } from "@/lib/x-marketing-meta";

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\S+/g, "")
      .replace(/@\w+/g, "")
      .split(/\W+/)
      .filter((w) => w.length > 3),
  );
}

/** Jaccard similarity 0–1. */
export function textSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) {
    if (tb.has(w)) inter += 1;
  }
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

const SIMILAR_THRESHOLD = 0.55;

/** True if body is too close to a recent @BlackOutTrade post. */
export async function isTooSimilarToRecentPosts(body: string): Promise<{
  similar: boolean;
  matched?: string;
  score?: number;
}> {
  const hooks = await getRecentPostHooks();
  const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 15);
  const bodies = [
    ...hooks,
    ...tweets
      .map((t) => (t.text ?? "").split("\n")[0] ?? "")
      .filter(Boolean),
  ];

  for (const prev of bodies) {
    const score = textSimilarity(body, prev);
    if (score >= SIMILAR_THRESHOLD) {
      return { similar: true, matched: prev.slice(0, 80), score };
    }
  }
  return { similar: false };
}

export function dedupRewriteHint(matched?: string): string {
  return matched
    ? `\n\nIMPORTANT: Do NOT repeat this recent post angle: "${matched}…" — fresh hook, same live data.`
    : "";
}
