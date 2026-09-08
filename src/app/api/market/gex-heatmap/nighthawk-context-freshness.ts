import { isZeroDteMarkStale } from "@/lib/zerodte/marks-math";

/** Night Hawk context on the GEX matrix only surfaces editions from the last 24 hours. */
export const NIGHTHAWK_CONTEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a playable Night Hawk edition's `published_at` is fresh enough to attach to
 * `/api/market/gex-heatmap` context. Rejects future-dated stamps (cross-process clock skew)
 * and editions older than 24h — same guard class as `getNhConfluenceBonus` in spx-play-engine.
 */
export function isNighthawkContextEditionFresh(
  publishedAtIso: string,
  nowMs = Date.now()
): boolean {
  const publishedAtMs = new Date(publishedAtIso).getTime();
  return !isZeroDteMarkStale(publishedAtMs, nowMs, NIGHTHAWK_CONTEXT_MAX_AGE_MS);
}
