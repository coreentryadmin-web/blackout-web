import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { VECTOR_DTE_HORIZONS } from "@/features/vector/lib/vector-dte-horizon";
import { computeVectorFullState } from "@/lib/bie/vector-full-state";
import { writeVectorFullStateCache } from "@/lib/bie/vector-full-state-cache";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";

// Continuous Vector full-state ingestion — the "non-stop feed" behind Largo-BIE.
//
// Every RTH tick this snapshots the COMPLETE Vector desk state (regime / walls + integrity / flip /
// magnet / max-pain / expected-move / ladder / heatmap / flow / beads + wall-dynamics / VEX /
// dark-pool / server technicals / the derived play) for every universe ticker × each DTE horizon
// and writes it to Redis (vector:full-state:{ticker}:{horizon}). Readers (get_ecosystem_context,
// the get_vector_full_state Largo tool, composeVectorRead) then read cache-first via
// fetchVectorFullState, so BIE serves the current state for any stock/horizon instantly without a
// per-query fan-out. Mirrors the vector-universe-snapshot cron's shape (isCronAuthorized + RTH gate
// + force + logCronRun); reuses the same Redis-cached chain, so a ticker's four horizons share one
// chain fetch.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Stop composing new snapshots past this so we always return + log under maxDuration. */
const TIME_BUDGET_MS = 50_000;
/** Tickers processed concurrently — bounded so we never fan a burst of provider calls at once. */
const TICKER_CONCURRENCY = 3;

/**
 * Cross-replica overlap guard. Measured live on prod 2026-09-02: TIME_BUDGET_MS only checks
 * the clock BETWEEN ticker batches, not within one — so when a single Promise.all(batch) blocks
 * on the shared cluster-wide Polygon/UW rate limiters (GLOBAL_MAX_RPS=2, GLOBAL_MAX_CONCURRENCY
 * 2-3 — uw-rate-limiter.ts / polygon-rate-limiter.ts), one slow batch alone can blow the 50s
 * budget many times over. Confirmed: elapsed=334995ms (5m35s) against this cron's own 5-minute
 * EventBridge schedule (`2-59/5 11-21 * * 1-5`, blackout-infra cron-jobs.json) with NO overlap
 * guard, so the very next scheduled fire landed while the previous run was still in flight
 * (derived start/end intervals overlapped by ~35s at 16:10:08-16:12:12 UTC) — both instances then
 * hit the SAME rate limiters real member requests depend on, in the same window ALB
 * TargetResponseTime read p99 44,745-95,367ms / Max up to 119,048ms (CloudWatch, 16:01-16:31 UTC).
 * Same `sharedCacheSetNx` idempotent-skip pattern already used by vector-pick-sweep/zerodte-warm
 * for this exact problem shape. TTL (900s) matches this cron's own `stale_after_min: 15`
 * alerting threshold (cron-registry.ts) as the safety-net ceiling if a release is ever missed.
 */
const OVERLAP_LOCK_KEY = "vector:full-state-snapshot:running";
const OVERLAP_LOCK_TTL_SEC = 900;

async function runVectorFullStateSnapshot(started: number): Promise<void> {
  try {
    const tickers = vectorUniverseTickers();
    let written = 0;
    let skippedNoSpot = 0;
    let failed = 0;
    let budgetHit = false;

    for (let i = 0; i < tickers.length; i += TICKER_CONCURRENCY) {
      // Time-budget guard: partial completion is fine — the snapshots carry `asOf`, and the next run
      // (or a reader's self-warm on miss) fills whatever this run didn't reach.
      if (Date.now() - started > TIME_BUDGET_MS) {
        budgetHit = true;
        break;
      }
      const batch = tickers.slice(i, i + TICKER_CONCURRENCY);
      await Promise.all(
        batch.map(async (ticker) => {
          for (const horizon of VECTOR_DTE_HORIZONS) {
            try {
              const state = await computeVectorFullState(ticker, horizon);
              if (state) {
                await writeVectorFullStateCache(ticker, horizon, state);
                written += 1;
              } else {
                // No live spot for this ticker/horizon (cold matrix, off-universe symbol) — honest skip.
                skippedNoSpot += 1;
              }
            } catch {
              failed += 1; // one ticker/horizon failing must never abort the sweep
            }
          }
        })
      );
    }

    console.info(
      `[cron/vector-full-state-snapshot] background done — tickers=${tickers.length} horizons=${VECTOR_DTE_HORIZONS.length} written=${written} skippedNoSpot=${skippedNoSpot} failed=${failed} budgetHit=${budgetHit} elapsed=${Date.now() - started}ms`
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

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-full-state-snapshot", started, payload);
    return NextResponse.json(payload);
  }

  const acquired = await sharedCacheSetNx(
    OVERLAP_LOCK_KEY,
    { startedAt: started },
    OVERLAP_LOCK_TTL_SEC
  ).catch(() => true); // fail OPEN on a Redis error — a missed overlap guard is safer than a stuck cron
  if (!acquired) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "previous full-state snapshot still in flight (idempotent skip)",
    };
    await logCronRun("vector-full-state-snapshot", started, payload);
    return NextResponse.json(payload);
  }

  // computeVectorFullState × universe × horizons can exceed Cloudflare's ~100s origin timeout
  // when caches are cold (ops #1355: market_hours_stale with no fresh cron_job_runs row). Mirror
  // bie-full-state-snapshot / vector-dark-pool-warm: handshake in seconds, sweep in after().
  const dispatchSnapshot = () => {
    void runVectorFullStateSnapshot(started).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/vector-full-state-snapshot] background snapshot REJECTED: ${detail}`);
    });
  };

  try {
    after(dispatchSnapshot);
  } catch {
    dispatchSnapshot();
  }

  const tickers = vectorUniverseTickers();
  const accepted = {
    ok: true,
    status: "accepted",
    reason: "Vector full-state snapshot dispatched in background (fire-and-forget)",
    tickers: tickers.length,
    horizons: VECTOR_DTE_HORIZONS.length,
  };
  await logCronRun("vector-full-state-snapshot", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Per-ticker×horizon full-state cache writes run in background — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
