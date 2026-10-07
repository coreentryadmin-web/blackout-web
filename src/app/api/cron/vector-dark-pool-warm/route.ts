import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { warmVectorDarkPool, type WarmVectorDarkPoolResult } from "@/features/vector/lib/vector-dark-pool-cache";
import { isEtCashRth } from "@/lib/et-market-hours";
import { runUwPool, runWithBackgroundUwSweep } from "@/lib/providers/uw-rate-limiter";
import { sharedCacheGet, sharedCacheSet, sharedCacheSetNx } from "@/lib/shared-cache";
import { halfBatchSize, selectDarkPoolWarmBatch } from "./rotation";

const ROTATION_CURSOR_KEY = "cron:vector-dark-pool-warm:cursor";
// Persist well past the ~10min schedule so a single missed/overlapping run doesn't reset coverage.
const ROTATION_CURSOR_TTL_SEC = 3600;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Unbounded-fan-out fix. Measured live 2026-09-02: `Promise.allSettled` fired all ~55 universe
 * tickers' `warmVectorDarkPool` calls at once, each immediately entering the UW rate limiter's
 * admission queue (GLOBAL_MAX_RPS=2, `DEFAULT_QUEUE_MAX_WAIT_MS`=20s in queue-budget.ts). With
 * that many simultaneous entrants, tickers near the back of the queue routinely waited past the
 * 20s budget and were dropped with a queue-timeout — 83-95% per-run ticker failures observed.
 * `runUwPool` (same pattern already used by nighthawk's `fetchIndexFlowsPooled`) bounds how many
 * `warmVectorDarkPool` calls — and therefore how many admission-queue entrants — are in flight at
 * once to `MAX_CONCURRENCY` (3, the rate limiter's own default), keeping each ticker's queue wait
 * well under the timeout instead of racing all 55 into the queue simultaneously. Each task still
 * catches its own rejection into a settled-result shape so one ticker's unexpected throw can't
 * abort the whole pool the way `Promise.all` would.
 *
 * ROTATION (2026-10-07). The bound above caps this cron's own CONCURRENCY, not its TOTAL per-run
 * ticker count — and a fresh re-measurement found the full universe still fails 90%+ of tickers
 * per run even after the shared UW rate limiter's cluster-wide ceiling was separately doubled
 * (PR #5579, UW_GLOBAL_MAX_RPS 2->4): aggregate cluster-wide UW demand (live traffic + sibling
 * crons) still saturates the shared admission queue, and this cron's full ~55-69-ticker ask is
 * simply more total work than the queue's 20s wait budget can clear every run. See rotation.ts's
 * header comment for the full measurement and why a 2-way (not larger) rotation was chosen. This
 * halves the per-run ticker count — full universe coverage every 2 runs instead of every 1 — which
 * halves this cron's own total admission-queue commitment without touching the shared limiter.
 */
async function runVectorDarkPoolWarm(started: number): Promise<void> {
  const allTickers = vectorUniverseTickers();
  const cursor = (await sharedCacheGet<number>(ROTATION_CURSOR_KEY).catch(() => null)) ?? 0;
  const { batch: tickers, nextCursor } = selectDarkPoolWarmBatch(
    allTickers,
    cursor,
    halfBatchSize(allTickers.length)
  );
  await sharedCacheSet(ROTATION_CURSOR_KEY, nextCursor, ROTATION_CURSOR_TTL_SEC).catch(() => undefined);

  const results = await runUwPool(
    tickers.map((t) => async (): Promise<PromiseSettledResult<WarmVectorDarkPoolResult>> => {
      try {
        return { status: "fulfilled", value: await warmVectorDarkPool(t) };
      } catch (reason) {
        return { status: "rejected", reason };
      }
    })
  );

  let warmed = 0;
  let levels = 0;
  let fetchFailed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.fetchFailed) {
        fetchFailed += 1;
      } else {
        warmed += 1;
        levels += r.value.levels;
      }
    }
  }
  const rejected = results.length - warmed - fetchFailed;
  const failed = fetchFailed + rejected;

  console.info(
    `[cron/vector-dark-pool-warm] background done — warmed=${warmed} failed=${failed} levels=${levels} batch=${tickers.length}/${allTickers.length} elapsed=${Date.now() - started}ms`
  );
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-dark-pool-warm", started, payload);
    return NextResponse.json(payload);
  }

  // Overlap guard: measured runtime can reach 220+ seconds with UW timeouts, and the 10-minute
  // schedule leaves 6+ minute margin. During high UW latency, prior runs can still be executing
  // when the next scheduled run starts, risking concurrent Redis writes to dark-pool cache keys.
  // Set NX on a lock key with 10m10s TTL to ensure only one run executes at a time.
  const acquired = await sharedCacheSetNx(
    "cron:vector-dark-pool-warm:lock",
    { startedAt: started },
    610 // TTL = 10min + 10sec buffer for schedule variance
  ).catch(() => true);

  if (!acquired) {
    const payload = { ok: true, skipped: true, reason: "Prior run still executing" };
    await logCronRun("vector-dark-pool-warm", started, payload);
    return NextResponse.json(payload);
  }

  // Tagged as a background sweep (runWithBackgroundUwSweep) so it always leaves at least one
  // UW concurrency slot reachable for live member traffic even while mid-run — see
  // uw-rate-limiter.ts's block comment for the measured ALB tail-latency evidence.
  const dispatchWarm = () => {
    void runWithBackgroundUwSweep(() => runVectorDarkPoolWarm(started)).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/vector-dark-pool-warm] background warm REJECTED: ${detail}`);
    });
  };

  try {
    after(dispatchWarm);
  } catch {
    dispatchWarm();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "vector dark-pool warm dispatched in background (fire-and-forget)",
    total: vectorUniverseTickers().length,
  };
  await logCronRun("vector-dark-pool-warm", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Per-ticker UW dark-pool cache writes run in background — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
