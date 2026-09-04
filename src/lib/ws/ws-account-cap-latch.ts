/**
 * Cluster-wide pause when Polygon/Massive refuses a socket for account connection cap.
 *
 * Per-socket 60s cooldown is not enough: each retry still completes handshake+auth and briefly
 * occupies a slot, so indices/options/stocks compete and the account stays pinned at its cap.
 * One Redis latch lets every socket back off together until orphaned provider connections drain.
 */
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";

export const POLYGON_ACCOUNT_CAP_KEY = "polygon:ws:account_cap_until";

/** Default pause after any cap refusal — long enough for provider-side orphans to drain. */
export const POLYGON_ACCOUNT_CAP_PAUSE_MS = 300_000;

export function polygonAccountCapUntilMs(
  now = Date.now(),
  pauseMs = POLYGON_ACCOUNT_CAP_PAUSE_MS
): number {
  return now + pauseMs;
}

export function remainingAccountCapPauseMs(untilMs: number, now = Date.now()): number {
  if (!Number.isFinite(untilMs) || untilMs <= now) return 0;
  return untilMs - now;
}

/** Record account-level cap hit; returns the unix-ms until which reconnects should pause. */
export async function recordPolygonAccountCapHit(
  pauseMs = POLYGON_ACCOUNT_CAP_PAUSE_MS,
  now = Date.now()
): Promise<number> {
  const until = polygonAccountCapUntilMs(now, pauseMs);
  try {
    const redis = await getUwCacheRedis();
    if (!redis) return until;
    const ttlSec = Math.max(1, Math.ceil(pauseMs / 1000));
    await redis.setex(POLYGON_ACCOUNT_CAP_KEY, ttlSec, String(until));
  } catch {
    /* non-fatal — per-socket cooldown still applies */
  }
  return until;
}

/** Milliseconds to wait before opening another Polygon WS (0 = clear to try). */
export async function readPolygonAccountCapPauseMs(now = Date.now()): Promise<number> {
  try {
    const redis = await getUwCacheRedis();
    if (!redis) return 0;
    const raw = await redis.get(POLYGON_ACCOUNT_CAP_KEY);
    if (!raw) return 0;
    const until = Number(raw);
    return remainingAccountCapPauseMs(until, now);
  } catch {
    return 0;
  }
}
