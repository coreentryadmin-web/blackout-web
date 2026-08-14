import "server-only";

import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { listSharedUniverseTickers } from "./vector-dynamic-universe";
import { normalizeVectorTicker } from "./vector-ticker";

/** How long the in-process shared-universe set is trusted before a Redis refresh. */
const REFRESH_MS = 30_000;

let sharedSet: Set<string> = new Set(vectorUniverseTickers());
let lastRefreshMs = 0;
let refreshInFlight: Promise<void> | null = null;

/** Synchronous membership check — static ∪ dynamic (≤100 / 14d), refreshed async. */
export function isSharedUniverseTickerSync(ticker: string): boolean {
  const t = normalizeVectorTicker(ticker);
  return t.length > 0 && sharedSet.has(t);
}

export function getSharedUniverseSetForTest(): ReadonlySet<string> {
  return sharedSet;
}

/** Replace the set (tests only). */
export function _setSharedUniverseForTest(tickers: readonly string[]): void {
  sharedSet = new Set(tickers.map((t) => normalizeVectorTicker(t)));
  lastRefreshMs = Date.now();
}

export function _resetSharedUniverseCacheForTest(): void {
  sharedSet = new Set(vectorUniverseTickers());
  lastRefreshMs = 0;
  refreshInFlight = null;
}

/** Pull static ∪ dynamic from Redis when stale. Never throws into hot paths. */
export async function refreshSharedUniverseCacheIfStale(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRefreshMs < REFRESH_MS) return;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const tickers = await listSharedUniverseTickers();
      sharedSet = new Set(tickers.map((t) => normalizeVectorTicker(t)));
      lastRefreshMs = Date.now();
    } catch {
      /* keep prior set — stale membership beats an empty set */
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
