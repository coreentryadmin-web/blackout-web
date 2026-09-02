import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { warmVectorDarkPool, type WarmVectorDarkPoolResult } from "@/features/vector/lib/vector-dark-pool-cache";
import { isEtCashRth } from "@/lib/et-market-hours";
import { runUwPool } from "@/lib/providers/uw-rate-limiter";

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
 */
async function runVectorDarkPoolWarm(started: number): Promise<void> {
  const tickers = vectorUniverseTickers();
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
    `[cron/vector-dark-pool-warm] background done — warmed=${warmed} failed=${failed} levels=${levels} elapsed=${Date.now() - started}ms`
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

  const dispatchWarm = () => {
    void runVectorDarkPoolWarm(started).catch((error) => {
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
