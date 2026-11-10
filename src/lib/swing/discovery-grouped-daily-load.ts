import type { DailyMarketBar } from "@/lib/providers/polygon";

function isGroupedDailyRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate limit|Circuit open/i.test(msg);
}

/**
 * One grouped-daily REST pull per swing-discovery scan — `buildDiscoveryDeps` used to call
 * `fetchDailyMarketSummary` up to three times per phase (core screen, banger origin, intraday
 * refresh preamble). Under Polygon pressure that tripled 429 exposure on the heaviest endpoint in
 * the route. Memoize the in-flight promise and retry transient rate-limit/circuit errors with
 * backoff before failing the whole scan.
 */
export function createMemoizedGroupedDailyLoader(
  fetchSummary: (ymd: string) => Promise<{ results?: DailyMarketBar[] }>,
  ymd: string,
  opts?: { maxAttempts?: number; baseDelayMs?: number }
): () => Promise<DailyMarketBar[]> {
  let inflight: Promise<DailyMarketBar[]> | undefined;
  const maxAttempts = opts?.maxAttempts ?? 4;
  const baseDelayMs = opts?.baseDelayMs ?? 1500;

  return async () => {
    if (!inflight) {
      inflight = (async () => {
        let lastErr: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const summary = await fetchSummary(ymd);
            return summary.results ?? [];
          } catch (err) {
            lastErr = err;
            if (!isGroupedDailyRetryable(err) || attempt >= maxAttempts - 1) throw err;
            await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
          }
        }
        throw lastErr;
      })();
    }
    return inflight;
  };
}
