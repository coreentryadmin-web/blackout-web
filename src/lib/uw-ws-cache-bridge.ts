/**
 * Seed Redis uw_cache:* from in-process UW WebSocket stores when channels are fresh.
 * Keeps the 2-RPS REST budget for paths the multiplex socket already delivers.
 */
import type { DarkPoolSnapshot } from "@/lib/providers/unusual-whales";
import type { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import {
  aggregateFlowPerStrikeRows,
  aggregateOptionTradesToStrikeRows,
  type NetPremTick,
} from "@/lib/providers/unusual-whales";
import { UW_CACHE_TTL, UW_KEYS, uwCacheRead, uwCacheSet } from "@/lib/providers/uw-shared-cache";
import {
  darkPoolRecentRing,
  darkPoolStore,
  getNetPremTicksForTicker,
  isUwChannelFresh,
  optionTradesStore,
  tideStore,
} from "@/lib/ws/uw-socket";

export type UwWsCacheSeedResult = {
  seeded: number;
  skipped_ws: string[];
};

export async function seedUwCacheFromWsStores(
  redis: Awaited<ReturnType<typeof getUwCacheRedis>>
): Promise<UwWsCacheSeedResult> {
  const skipped_ws: string[] = [];
  let seeded = 0;

  if (isUwChannelFresh("market_tide", 180_000) && tideStore.updatedAt > 0) {
    await uwCacheSet(redis, UW_KEYS.marketTide(), UW_CACHE_TTL.marketTide, {
      call_premium: tideStore.call_premium,
      put_premium: tideStore.put_premium,
      net: tideStore.net,
      bias: tideStore.bias,
    });
    seeded += 1;
    skipped_ws.push("market_tide");
  }

  // Two independent off_lit_trades writes share one channel-freshness gate: the market-wide
  // recent-ring (dark_pool_recent) and the SPX ticker-level snapshot (dark_pool:SPX:...). Either
  // can fire alone (the ring can be empty while the ticker store still has data, and vice versa),
  // so track whether EITHER actually seeded rather than only counting/reporting the first — a
  // ticker-only seed used to seed real data into Redis while silently NOT incrementing `seeded`
  // and NOT appending "off_lit_trades" to `skipped_ws`, undercounting the one WS-health metric
  // (`ws_seeded`/`ws_skipped` on GET /api/cron/uw-cache-refresh) ops uses to tell whether the WS
  // bridge is actually covering this channel.
  let offLitSeeded = false;
  if (isUwChannelFresh("off_lit_trades", 120_000) && darkPoolRecentRing.rows.length > 0) {
    // dark_pool_recent must be raw UW rows (array) — NOT a DarkPoolSnapshot object.
    await uwCacheSet(redis, UW_KEYS.darkPoolRecent(), UW_CACHE_TTL.darkPoolRecent, darkPoolRecentRing.rows);
    seeded += 1;
    offLitSeeded = true;
  }

  if (isUwChannelFresh("off_lit_trades", 120_000) && darkPoolStore.updatedAt > 0 && darkPoolStore.data) {
    await uwCacheSet(redis, UW_KEYS.darkPoolTicker("SPX"), UW_CACHE_TTL.darkPoolTicker, darkPoolStore.data);
    seeded += 1;
    offLitSeeded = true;
  }
  if (offLitSeeded) skipped_ws.push("off_lit_trades");

  if (isUwChannelFresh("net_flow", 120_000)) {
    for (const ticker of ["SPX", "SPY", "QQQ", "IWM"] as const) {
      const ticks: NetPremTick[] = getNetPremTicksForTicker(ticker);
      if (!ticks.length) continue;
      await uwCacheSet(redis, UW_KEYS.netPremTicks(ticker), UW_CACHE_TTL.netPremTicks, ticks);
      seeded += 1;
    }
    skipped_ws.push("net_flow");
  }

  if (isUwChannelFresh("option_trades", 120_000) && optionTradesStore.rows.length > 0) {
    for (const ticker of ["SPX", "SPY"] as const) {
      const rows = aggregateOptionTradesToStrikeRows(optionTradesStore.rows, ticker);
      if (!rows.length) continue;
      await uwCacheSet(redis, UW_KEYS.flowPerStrike(ticker), UW_CACHE_TTL.flowPerStrike, aggregateFlowPerStrikeRows(rows));
      seeded += 1;
    }
    skipped_ws.push("option_trades");
  }

  return { seeded, skipped_ws };
}

/** Cross-replica read: Redis snapshot seeded by the UW WS leader (no REST). */
export async function readUwDeskLaneFromRedis<T>(key: string): Promise<T | null> {
  return uwCacheRead<T>(key);
}

export async function readUwMarketTideFromRedis(): Promise<{
  call_premium: number;
  put_premium: number;
  net: number;
  bias: string;
} | null> {
  return readUwDeskLaneFromRedis(UW_KEYS.marketTide());
}

export async function readUwDarkPoolFromRedis(ticker = "SPX"): Promise<DarkPoolSnapshot | null> {
  const tickerSnap = await readUwDeskLaneFromRedis<DarkPoolSnapshot>(UW_KEYS.darkPoolTicker(ticker));
  if (tickerSnap?.prints?.length) return tickerSnap;
  return readUwDeskLaneFromRedis<DarkPoolSnapshot>(UW_KEYS.darkPoolRecent());
}

/** Freshness for `dark_pool_recent` — gated on `darkPoolRecentRing`, the exact store
 * `seedUwCacheFromWsStores` reads to write `UW_KEYS.darkPoolRecent()`. */
function darkPoolWsFresh(): boolean {
  return (
    isUwChannelFresh("off_lit_trades", 120_000) &&
    darkPoolRecentRing.rows.length > 0 &&
    darkPoolRecentRing.updatedAt > 0
  );
}

/**
 * Freshness for the SPX ticker-level dark-pool snapshot specifically — gated on
 * `darkPoolStore`, the exact store `seedUwCacheFromWsStores` reads to write
 * `UW_KEYS.darkPoolTicker("SPX")`, NOT the market-wide `darkPoolRecentRing`.
 *
 * The two stores are independent parses of the SAME `off_lit_trades` WS payload —
 * `extractDarkPoolRawRows` (feeds the ring, no premium/date filter — any object
 * passes) vs `normalizeDarkPoolWsPayload` (feeds `darkPoolStore`, drops rows with
 * premium<=0 or whose `executed_at` isn't today's ET session and returns null when
 * nothing survives). A payload that keeps the ring "fresh" can leave `darkPoolStore`
 * stale — e.g. every row in a frame has premium<=0, or carries a prior-session
 * timestamp. Before this fix, `shouldSkipUwCacheRefreshTask("dark_pool_ticker","SPX")`
 * reused `darkPoolWsFresh()` (the ring check) for that decision, so the cron would
 * skip the REST refresh for `dark_pool_ticker:SPX` on the strength of a signal that
 * does not describe what that cache key actually holds — leaving it silently stale
 * with neither WS nor REST ever refreshing it.
 */
function darkPoolTickerWsFresh(): boolean {
  return (
    isUwChannelFresh("off_lit_trades", 120_000) &&
    darkPoolStore.updatedAt > 0 &&
    darkPoolStore.data != null
  );
}

export function shouldSkipUwCacheRefreshTask(
  task: "market_tide" | "net_prem_ticks" | "flow_per_strike" | "dark_pool_recent" | "dark_pool_ticker",
  ticker?: string
): boolean {
  if (task === "market_tide") {
    return isUwChannelFresh("market_tide", 180_000) && tideStore.updatedAt > 0;
  }
  if (task === "net_prem_ticks" && ticker) {
    return isUwChannelFresh("net_flow", 120_000) && getNetPremTicksForTicker(ticker).length > 0;
  }
  if (task === "flow_per_strike" && ticker) {
    return (
      isUwChannelFresh("option_trades", 120_000) &&
      aggregateOptionTradesToStrikeRows(optionTradesStore.rows, ticker).length > 0
    );
  }
  if (task === "dark_pool_recent") {
    return darkPoolWsFresh();
  }
  // WS off_lit_trades seeds SPX from the ticker-level store; skip per-ticker REST for SPX only.
  if (task === "dark_pool_ticker" && ticker === "SPX") {
    return darkPoolTickerWsFresh();
  }
  return false;
}
