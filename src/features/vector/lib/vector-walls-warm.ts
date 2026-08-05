/**
 * Vector walls cache pre-warming.
 * Called by /api/cron/vector-walls-warm to keep GEX/VEX walls hot so the SSE stream
 * (which ticks every 1s) sees cache hits instead of expensive re-computations.
 */

import { recordVectorWallSamplesFromWarm } from "./vector-snapshot";
import { getActiveVectorTickers } from "./vector-stream-hub";
import { listDynamicUniverseTickers, mergeSharedUniverseTickers } from "./vector-dynamic-universe";

export async function warmVectorWalls(ticker: string): Promise<void> {
  // Prime scope, warm caches, and persist a wall-history sample so non-SPX tickers
  // accumulate bead rails at the warm cadence (~15–30s) without a live viewer.
  await recordVectorWallSamplesFromWarm(ticker).catch(() => false);
}

/**
 * Tickers to warm: static allowlist ∪ dynamic sticky universe ∪ live SSE viewers.
 * Sync helper kept for tests that pass an explicit dynamic list.
 */
export function getTickersToWarm(
  allowlist: string[],
  dynamic: string[] = [],
  active: string[] = getActiveVectorTickers()
): string[] {
  return mergeSharedUniverseTickers(allowlist, [...dynamic, ...active]);
}

/** Async warm set — same shared universe Thermal heatmap-warm uses, plus live viewers. */
export async function getTickersToWarmAsync(allowlist: string[]): Promise<string[]> {
  const dynamic = await listDynamicUniverseTickers().catch(() => [] as string[]);
  return getTickersToWarm(allowlist, dynamic, getActiveVectorTickers());
}
