/**
 * Seed Redis uw_cache:* from in-process UW WebSocket stores when channels are fresh.
 * Keeps the 2-RPS REST budget for paths the multiplex socket already delivers.
 */
import type { DarkPoolSnapshot, DarkPoolPrint } from "@/lib/providers/unusual-whales";
import type { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import {
  aggregateFlowPerStrikeRows,
  aggregateOptionTradesToStrikeRows,
  coerceDarkPoolRecentRows,
  darkPoolBias,
  type NetPremTick,
} from "@/lib/providers/unusual-whales";
import { UW_CACHE_TTL, UW_KEYS, uwCacheRead, uwCacheSet } from "@/lib/providers/uw-shared-cache";
import { execAtEtYmd, todayEt } from "@/lib/et-date";
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

/** Same $5 strike rounding `unusual-whales.ts`'s dark-pool shapers use (bucketPrice there). */
function bucketStrike(price: number, step = 5): number {
  return Math.round(Math.round(price / step) * step * 100) / 100;
}

/**
 * Reshape raw UW dark-pool rows (the `dark_pool_recent` cache contract — see
 * `coerceDarkPoolRecentRows`'s own doc comment: "that key stores raw API rows for Largo/tools",
 * NOT a `DarkPoolSnapshot`) into the `DarkPoolSnapshot` shape callers actually expect. Mirrors
 * `fetchUwDarkPoolMarketWide`'s today-ET-session + positive-premium filtering so a row from a
 * prior session (the ring can carry stale rows across a cold Redis TTL boundary) or a malformed
 * zero-premium row never masquerades as a live print. Pure — exported for unit tests.
 */
export function darkPoolSnapshotFromRecentRows(
  rows: Record<string, unknown>[],
  today: string = todayEt()
): DarkPoolSnapshot | null {
  const prints: DarkPoolPrint[] = [];
  let callPrem = 0;
  let putPrem = 0;
  let total = 0;

  for (const row of rows) {
    const execAt = String(row.executed_at ?? row.date ?? "");
    if (!execAt) continue;
    const execDay = execAtEtYmd(execAt);
    if (execDay !== today) continue;

    const premium = Number(row.premium ?? row.size ?? row.notional ?? 0);
    if (!(premium > 0)) continue;

    const strikeRaw = Number(row.strike ?? row.price ?? row.ref_price ?? 0);
    const strike = Number.isFinite(strikeRaw) ? bucketStrike(strikeRaw) : 0;
    const side = String(row.side ?? row.direction ?? "unknown").toLowerCase();
    const optType = String(row.type ?? row.option_type ?? "").toLowerCase();
    const ticker = row.ticker ? String(row.ticker) : undefined;

    prints.push({ strike, premium, side, executed_at: execAt, ticker });
    total += premium;
    if (optType.includes("call")) callPrem += premium;
    else if (optType.includes("put")) putPrem += premium;
  }

  if (!prints.length) return null;
  const bias = darkPoolBias(callPrem, putPrem, total);
  return {
    prints: prints.slice(0, 20),
    total_premium: total,
    call_premium: callPrem,
    put_premium: putPrem,
    bias,
    pcr: callPrem > 0 ? Math.round((putPrem / callPrem) * 100) / 100 : null,
    detail: `${prints.length} print(s) | $${(total / 1_000_000).toFixed(2)}M`,
  };
}

/**
 * BUG FIX (round 329): this used to read `UW_KEYS.darkPoolRecent()` and cast the result straight
 * to `DarkPoolSnapshot` — but that key's documented, actual contract (`coerceDarkPoolRecentRows`'s
 * own header, and both of this key's writers: `seedUwCacheFromWsStores` above and
 * `fetchUwDarkPoolRecent` in unusual-whales.ts) is a RAW ARRAY of UW rows, never a
 * `DarkPoolSnapshot` object. A JS array has no `.prints` field, so every caller's own freshness
 * guard (`spx-desk.ts`'s `resolveDarkPool`: `if (redisDp?.prints?.length) return redisDp;`)
 * evaluated falsy on every single call — the fallback silently never activated, even when the
 * cache held perfectly good, fresh, WS-seeded market-wide dark-pool rows. Reshape the raw rows
 * into a real snapshot instead of mis-typing the cache value.
 */
export async function readUwDarkPoolFromRedis(ticker = "SPX"): Promise<DarkPoolSnapshot | null> {
  const tickerSnap = await readUwDeskLaneFromRedis<DarkPoolSnapshot>(UW_KEYS.darkPoolTicker(ticker));
  if (tickerSnap?.prints?.length) return tickerSnap;
  const recentRaw = await readUwDeskLaneFromRedis<unknown>(UW_KEYS.darkPoolRecent());
  const rows = coerceDarkPoolRecentRows(recentRaw);
  return rows ? darkPoolSnapshotFromRecentRows(rows) : null;
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
