/**
 * Vector walls cache pre-warming.
 * Called by /api/cron/vector-walls-warm to keep GEX/VEX walls hot so the SSE stream
 * (which ticks every 1s) sees cache hits instead of expensive re-computations.
 *
 * Wall-history bead recording is owned by vector-bead-recorder-leader (5s, full universe).
 */

import { getVectorGexWalls, getVectorVexWalls, primeVectorWallScope } from "./vector-snapshot";
import { joinGexStrikeExpiryTicker } from "@/lib/ws/uw-socket";
import { getActiveVectorTickers } from "./vector-stream-hub";
import { listDynamicUniverseTickers, mergeSharedUniverseTickers } from "./vector-dynamic-universe";

export async function warmVectorWalls(ticker: string): Promise<void> {
  joinGexStrikeExpiryTicker(ticker);
  await primeVectorWallScope(ticker);
  await Promise.all([
    Promise.resolve(getVectorGexWalls(ticker)),
    Promise.resolve(getVectorVexWalls(ticker)),
  ]);
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
