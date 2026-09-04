// Cron: pre-warm Unusual Whales Redis cache for top tickers and market-wide signals.
// Schedule: every 2 minutes (registered in cron-registry.ts as "uw-cache-refresh").
// When UW WS channels are fresh, seeds Redis from in-process stores first and skips
// the matching REST warm tasks (see uw-ws-cache-bridge.ts).

import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { getUwCacheRedis, uwCacheSet, UW_KEYS, UW_CACHE_TTL } from "@/lib/providers/uw-shared-cache";
import {
  fetchUwMarketTide,
  fetchUwSectorTide,
  fetchUwDarkPoolRecent,
  fetchUwMarketTopNetImpact,
  fetchUwCongressTrades,
  fetchUwNetPremTicks,
  fetchUwNope,
  fetchUwDarkPool,
  fetchUwFlowPerStrikeRows,
  UW_FLOW_PER_STRIKE_FETCH_CAP,
  aggregateFlowPerStrikeRows,
} from "@/lib/providers/unusual-whales";
import { fetchMarketMovers } from "@/lib/providers/polygon";
import { seedUwCacheFromWsStores, shouldSkipUwCacheRefreshTask } from "@/lib/uw-ws-cache-bridge";
import { seedPulseSnapshotFromUwPrices, seedUwClusterHeartbeat } from "@/lib/ws/socket-cluster-health";
import { runWithBackgroundUwSweep } from "@/lib/providers/uw-rate-limiter";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";

/**
 * Cross-replica overlap guard. This cron fires every 2 min while measured background runtime
 * is 20–66s on an 8–15 replica web fleet — without a lock, overlapping 24-way UW REST fan-outs
 * stack and starve live member traffic (939 rate-limiter failures in one 2.5h RTH window on
 * 2026-09-04, clustering at the start of this cron's run windows). Same `sharedCacheSetNx`
 * idempotent-skip pattern as desk-warm / vector-pick-sweep. TTL (600s) matches
 * `stale_after_min: 10` as the safety-net ceiling if a release is ever missed.
 */
const OVERLAP_LOCK_KEY = "uw-cache-refresh:running";
const OVERLAP_LOCK_TTL_SEC = 600;

const INDEX_TICKERS = ["SPX", "SPY", "QQQ", "IWM"] as const;
const FLOW_STRIKE_TICKERS = ["SPX", "SPY"] as const;
const SECTORS = [
  "technology",
  "financial services",
  "energy",
  "healthcare",
  "consumer cyclical",
] as const;

async function runUwCacheRefreshTasks(
  started: number,
  redis: Awaited<ReturnType<typeof getUwCacheRedis>>
): Promise<void> {
  try {
  const tasks: Array<() => Promise<void>> = [
    async () => {
      if (shouldSkipUwCacheRefreshTask("market_tide")) return;
      const data = await fetchUwMarketTide();
      await uwCacheSet(redis, UW_KEYS.marketTide(), UW_CACHE_TTL.marketTide, data);
    },

    ...SECTORS.map((sector) => async () => {
      const data = await fetchUwSectorTide(sector);
      await uwCacheSet(redis, UW_KEYS.sectorTide(sector), UW_CACHE_TTL.sectorTide, data);
    }),

    async () => {
      if (shouldSkipUwCacheRefreshTask("dark_pool_recent")) return;
      const data = await fetchUwDarkPoolRecent();
      await uwCacheSet(redis, UW_KEYS.darkPoolRecent(), UW_CACHE_TTL.darkPoolRecent, data);
    },

    async () => {
      const data = await fetchMarketMovers(20);
      await uwCacheSet(redis, UW_KEYS.marketMovers(), UW_CACHE_TTL.marketMovers, data);
    },

    async () => {
      const data = await fetchUwMarketTopNetImpact();
      await uwCacheSet(redis, UW_KEYS.topNetImpact(), UW_CACHE_TTL.topNetImpact, data);
    },

    async () => {
      const data = await fetchUwCongressTrades();
      await uwCacheSet(redis, UW_KEYS.congress(), UW_CACHE_TTL.congress, data);
    },

    ...INDEX_TICKERS.flatMap((ticker) => [
      async () => {
        if (shouldSkipUwCacheRefreshTask("net_prem_ticks", ticker)) return;
        const data = await fetchUwNetPremTicks(ticker);
        await uwCacheSet(redis, UW_KEYS.netPremTicks(ticker), UW_CACHE_TTL.netPremTicks, data);
      },
      async () => {
        const data = await fetchUwNope(ticker);
        await uwCacheSet(redis, UW_KEYS.nope(ticker), UW_CACHE_TTL.nope, data);
      },
      async () => {
        if (shouldSkipUwCacheRefreshTask("dark_pool_ticker", ticker)) return;
        const data = await fetchUwDarkPool(ticker);
        await uwCacheSet(redis, UW_KEYS.darkPoolTicker(ticker), UW_CACHE_TTL.darkPoolTicker, data);
      },
    ]),

    ...FLOW_STRIKE_TICKERS.map((ticker) => async () => {
      if (shouldSkipUwCacheRefreshTask("flow_per_strike", ticker)) return;
      const rows = await fetchUwFlowPerStrikeRows(ticker, UW_FLOW_PER_STRIKE_FETCH_CAP);
      await uwCacheSet(
        redis,
        UW_KEYS.flowPerStrike(ticker),
        UW_CACHE_TTL.flowPerStrike,
        aggregateFlowPerStrikeRows(rows)
      );
    }),
  ];

  const results = await Promise.allSettled(tasks.map((fn) => fn()));
  const refreshed = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  if (refreshed > 0) {
    await seedUwClusterHeartbeat();
  }
  if (failed > 0) {
    console.warn(`[cron/uw-cache-refresh] background: ${failed}/${tasks.length} task(s) failed`);
  }
  console.info(
    `[cron/uw-cache-refresh] background done — refreshed=${refreshed} failed=${failed} elapsed=${Date.now() - started}ms`
  );
  } finally {
    await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined);
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = await getUwCacheRedis();
  let ws_seeded = 0;
  let ws_skipped: string[] = [];

  const seed = await seedUwCacheFromWsStores(redis);
  ws_seeded = seed.seeded;
  ws_skipped = seed.skipped_ws;

  // Seed pulse snapshot FIRST — socket-health + GEX spot readers depend on this during RTH when
  // polygon indices WS is ingest-owned. Must complete before the heavy REST fan-out (#1343).
  const pulse_seeded = await seedPulseSnapshotFromUwPrices();

  // Tagged as a background sweep (runWithBackgroundUwSweep) so it always leaves at least one
  // UW concurrency slot reachable for live member traffic even while mid-run — see
  // uw-rate-limiter.ts's block comment for the measured ALB tail-latency evidence. This cron's
  // own 24-way fan-out (5 sector tides + 3 index tickers × 3 fetches + 5 singles + 2 flow-per-
  // strike) was the one remaining un-tagged caller found in the 2026-09-04 audit sweep: live
  // CloudWatch showed 939 real member-facing "[uw] flow-alerts failed: rate-limiter queue budget
  // exceeded" events in one 2.5h RTH window, clustering inside/at-the-start of this cron's own
  // measured 20-66s run windows (vs. 27 such failures in an equivalent off-hours window).
  const acquired = await sharedCacheSetNx(
    OVERLAP_LOCK_KEY,
    { startedAt: started },
    OVERLAP_LOCK_TTL_SEC
  ).catch(() => true); // fail OPEN on Redis error — missed guard safer than a stuck cron
  if (!acquired) {
    const skipped = {
      ok: true,
      skipped: true,
      reason: "previous UW cache refresh still in flight (idempotent skip)",
      ws_seeded,
      ws_skipped,
      pulse_seeded,
    };
    await logCronRun("uw-cache-refresh", started, skipped);
    return NextResponse.json(skipped);
  }

  const dispatchRefresh = () => {
    void runWithBackgroundUwSweep(() => runUwCacheRefreshTasks(started, redis)).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/uw-cache-refresh] background refresh REJECTED: ${detail}`);
    });
  };

  try {
    after(dispatchRefresh);
  } catch {
    dispatchRefresh();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "UW REST cache refresh dispatched in background (fire-and-forget)",
    ws_seeded,
    ws_skipped,
    pulse_seeded,
  };
  await logCronRun("uw-cache-refresh", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Per-ticker UW REST warm runs in background — pulse snapshot seeded synchronously.",
    },
    { status: 202 }
  );
}
