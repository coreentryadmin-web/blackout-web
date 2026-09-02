import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { captureError } from "@/lib/error-sink";
import { sharedCacheGet, sharedCacheSet, sharedCacheDel } from "@/lib/shared-cache";
import {
  classifyWall,
  correctPublicRead,
  publicSnapshotSessionFacts,
  shouldAlarmPublicGexWarming,
  PUBLIC_GEX_WARMING_ALARM_SEC,
  type PublicGexSnapshot,
  type PublicGexTicker,
  sanitizePublicRead,
} from "@/lib/public-gex-snapshot-types";

export type { PublicGexSnapshot, PublicGexTicker, PublicWallRole } from "@/lib/public-gex-snapshot-types";
export {
  classifyWall,
  correctPublicRead,
  isPublicGexTicker,
  publicFreshnessCopy,
  publicGexTickers,
  publicSnapshotSessionFacts,
  sanitizePublicRead,
  shouldAlarmPublicGexWarming,
  PUBLIC_GEX_WARMING_ALARM_SEC,
} from "@/lib/public-gex-snapshot-types";

/**
 * Sanitized, PUBLIC projection of the GEX heatmap — the free lead-magnet snapshot
 * at /tools/gamma-snapshot (docs/marketing/SEO-GROWTH.md finding #5). Deliberately
 * thin: spot, call/put wall, gamma flip, and the regime read only — no strike/expiry
 * matrix, no flow/dark-pool overlays, nothing that would substitute for the real
 * (live, tick-by-tick) product members pay for.
 */

// 5s — matched to the lane underneath, NOT a loosened budget.
const CACHE_TTL_SEC = 5;
const EMPTY_CACHE_TTL_SEC = 30; // short-lived so a transient upstream miss self-heals fast
const LAST_GOOD_TTL_SEC = 86_400; // 24h — acquisition surface must not go blank on a blip

function warmingSinceKey(ticker: string): string {
  return `public-gex-snapshot:warming-since:${ticker}`;
}

function warmingAlarmKey(ticker: string): string {
  return `public-gex-snapshot:warming-alarm:${ticker}`;
}

async function clearWarmingState(ticker: string): Promise<void> {
  await Promise.all([
    sharedCacheDel(warmingSinceKey(ticker)).catch(() => undefined),
    sharedCacheDel(warmingAlarmKey(ticker)).catch(() => undefined),
  ]);
}

async function noteWarmingAndMaybeAlarm(ticker: string): Promise<void> {
  const sinceKey = warmingSinceKey(ticker);
  const alarmKey = warmingAlarmKey(ticker);
  const now = Date.now();
  let sinceMs = now;
  try {
    const existing = await sharedCacheGet<number>(sinceKey);
    if (typeof existing === "number" && Number.isFinite(existing)) {
      sinceMs = existing;
    } else {
      await sharedCacheSet(sinceKey, sinceMs, LAST_GOOD_TTL_SEC);
    }
  } catch {
    /* best-effort */
  }

  if (!shouldAlarmPublicGexWarming(sinceMs, now)) return;

  try {
    const already = await sharedCacheGet<number>(alarmKey);
    if (already) return;
    await sharedCacheSet(alarmKey, now, PUBLIC_GEX_WARMING_ALARM_SEC);
  } catch {
    return;
  }

  void captureError(
    new Error(`Public GEX snapshot warming >${PUBLIC_GEX_WARMING_ALARM_SEC}s for ${ticker}`),
    {
      source: "manual",
      scope: "public-gex-snapshot:warming",
      meta: {
        ticker,
        warming_since_ms: sinceMs,
        warming_age_sec: Math.round((now - sinceMs) / 1000),
      },
    }
  );
}

function snapshotAgeSec(asof: string | null): number | null {
  if (!asof) return null;
  const ms = Date.now() - new Date(asof).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms / 1000);
}

function withAgeFields(snapshot: PublicGexSnapshot): PublicGexSnapshot {
  return {
    ...snapshot,
    snapshot_data_age_seconds: snapshotAgeSec(snapshot.asof),
    warming_reason:
      snapshot.available || snapshot.degraded ? null : snapshot.warming_reason ?? "warming",
  };
}

function lastGoodKey(ticker: string): string {
  return `public-gex-snapshot:last-good:${ticker}`;
}

async function persistLastGood(snapshot: PublicGexSnapshot): Promise<void> {
  if (!snapshot.available || snapshot.spot == null) return;
  const durable: PublicGexSnapshot = {
    ...snapshot,
    degraded: false,
    degraded_note: null,
    warming_reason: null,
    snapshot_data_age_seconds: undefined,
  };
  await sharedCacheSet(lastGoodKey(snapshot.ticker), durable, LAST_GOOD_TTL_SEC).catch(() => undefined);
}

async function loadLastGood(ticker: string): Promise<PublicGexSnapshot | null> {
  try {
    const cached = await sharedCacheGet<PublicGexSnapshot>(lastGoodKey(ticker));
    if (!cached?.spot) return null;
    return cached;
  } catch {
    return null;
  }
}

function degradedFromLastGood(lastGood: PublicGexSnapshot, note: string): PublicGexSnapshot {
  const session = publicSnapshotSessionFacts();
  return withAgeFields({
    ...lastGood,
    available: true,
    degraded: true,
    degraded_note: note,
    market_session: session.market_session,
    session_date: session.session_date,
    as_of_et: session.as_of_et,
    read:
      lastGood.read ||
      "Last known dealer positioning — live feed temporarily unavailable. Levels below are from the most recent successful snapshot.",
  });
}

function emptySnapshot(ticker: string): PublicGexSnapshot {
  const session = publicSnapshotSessionFacts();
  return {
    available: false,
    ticker,
    spot: null,
    change_pct: null,
    asof: null,
    market_session: session.market_session,
    session_date: session.session_date,
    as_of_et: session.as_of_et,
    call_wall: null,
    put_wall: null,
    flip: null,
    posture: null,
    call_wall_role: null,
    put_wall_role: null,
    read: "Snapshot warming up — check back shortly.",
    warming_reason: "warming",
  };
}

function buildSnapshotFromHeatmap(
  ticker: PublicGexTicker,
  heatmap: NonNullable<Awaited<ReturnType<typeof fetchGexHeatmap>>>
): PublicGexSnapshot {
  const session = publicSnapshotSessionFacts();
  const constrainedCallWall =
    heatmap.gex.call_wall != null && heatmap.gex.call_wall > heatmap.spot
      ? heatmap.gex.call_wall
      : null;
  const constrainedPutWall =
    heatmap.gex.put_wall != null && heatmap.gex.put_wall < heatmap.spot
      ? heatmap.gex.put_wall
      : null;
  return {
    available: true,
    ticker,
    spot: heatmap.spot,
    change_pct: heatmap.change_pct,
    asof: heatmap.asof,
    market_session: session.market_session,
    session_date: session.session_date,
    as_of_et: session.as_of_et,
    call_wall: constrainedCallWall,
    put_wall: constrainedPutWall,
    flip: heatmap.gex.flip,
    posture: heatmap.gex.regime.posture,
    call_wall_role: classifyWall("call", constrainedCallWall, heatmap.spot),
    put_wall_role: classifyWall("put", constrainedPutWall, heatmap.spot),
    read: correctPublicRead(sanitizePublicRead(heatmap.gex.regime.read), {
      spot: heatmap.spot,
      call_wall: constrainedCallWall,
      put_wall: constrainedPutWall,
    }),
    ...(heatmap.spot_source !== undefined ? { spot_source: heatmap.spot_source } : {}),
    ...(heatmap.chain_truncated ? { chain_truncated: true } : {}),
    degraded: false,
    degraded_note: null,
  };
}

async function resolveMiss(
  ticker: PublicGexTicker,
  reason: string
): Promise<PublicGexSnapshot> {
  const lastGood = await loadLastGood(ticker);
  if (lastGood) {
    const degraded = degradedFromLastGood(lastGood, reason);
    await sharedCacheSet(`public-gex-snapshot:${ticker}`, degraded, CACHE_TTL_SEC).catch(
      () => undefined
    );
    return degraded;
  }
  const empty = withAgeFields(emptySnapshot(ticker));
  await sharedCacheSet(`public-gex-snapshot:${ticker}`, empty, EMPTY_CACHE_TTL_SEC).catch(
    () => undefined
  );
  void noteWarmingAndMaybeAlarm(ticker);
  return empty;
}

export async function buildPublicGexSnapshot(ticker: PublicGexTicker): Promise<PublicGexSnapshot> {
  const cacheKey = `public-gex-snapshot:${ticker}`;
  try {
    const cached = await sharedCacheGet<PublicGexSnapshot>(cacheKey);
    if (cached) return withAgeFields(cached);
  } catch {
    /* fall through to a fresh compute */
  }

  try {
    const heatmap = await fetchGexHeatmap(ticker);
    if (!heatmap) {
      return resolveMiss(ticker, "Live matrix unavailable — showing last known levels.");
    }
    const snapshot = withAgeFields(buildSnapshotFromHeatmap(ticker, heatmap));
    await persistLastGood(snapshot);
    await clearWarmingState(ticker);
    await sharedCacheSet(cacheKey, snapshot, CACHE_TTL_SEC).catch(() => undefined);
    return snapshot;
  } catch (err) {
    console.warn("[public-gex-snapshot] build failed", ticker, err);
    return resolveMiss(ticker, "Live refresh failed — showing last known levels.");
  }
}
