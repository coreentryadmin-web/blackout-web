// Cron: pre-warm Vector GEX/VEX walls cache for the shared sticky universe.
// Schedule: ~every 15-30s during market hours (registered in cron-registry.ts as
// "vector-walls-warm"; EventBridge wires the actual fire).
//
// THE POINT: The Vector SSE stream /api/market/vector/stream ticks at 1 Hz and calls
// buildVectorStreamPayload which re-computes walls from scratch if the cache (WALLS_CACHE_MS=900ms)
// expires. With 5-10 minute cron warming, the cache is cold >99% of the time, forcing expensive
// wall computations on every single tick. This cron keeps walls pre-computed so SSE sees cache
// hits and streams fast. Warm set = static allowlist ∪ dynamic ≤100/14d ∪ live SSE viewers —
// same shared universe Thermal heatmap-warm uses.

import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { listSharedUniverseTickers } from "@/features/vector/lib/vector-dynamic-universe";
import { warmVectorWalls, getTickersToWarmAsync } from "@/features/vector/lib/vector-walls-warm";
import { isEtCashRth } from "@/lib/et-market-hours";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Cross-replica overlap guard. vector-walls-warm has two independent trigger sources —
 * EventBridge's ~5min schedule AND the in-app rth-warm-leader (20s heal threshold in
 * rth-warm-leader-logic.ts) — with no lock between them. A leader-triggered heal-fire can
 * land on top of an EventBridge fire while the prior universe warm is still sweeping Polygon
 * chain fetches. Same `sharedCacheSetNx` idempotent-skip pattern as desk-warm/heatmap-warm.
 * TTL (240s) covers maxDuration (120s) as the safety-net ceiling if a release is missed.
 */
const OVERLAP_LOCK_KEY = "vector-walls-warm:running";
const OVERLAP_LOCK_TTL_SEC = 240;

async function runVectorWallsWarm(started: number): Promise<void> {
  try {
    const tickers = await getTickersToWarmAsync(await listSharedUniverseTickers());
    const results = await Promise.allSettled(tickers.map((t) => warmVectorWalls(t)));

    let warmed = 0;
    for (const r of results) {
      if (r.status === "fulfilled") warmed += 1;
    }
    const failed = results.length - warmed;
    if (failed > 0) {
      console.warn(`[cron/vector-walls-warm] ${failed} universe warm(s) failed`);
    }
    console.info(
      `[cron/vector-walls-warm] background done — warmed=${warmed}/${tickers.length} failed=${failed} elapsed=${Date.now() - started}ms`
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
    await logCronRun("vector-walls-warm", started, payload);
    return NextResponse.json(payload);
  }

  const acquired = await sharedCacheSetNx(
    OVERLAP_LOCK_KEY,
    { startedAt: started },
    OVERLAP_LOCK_TTL_SEC
  ).catch(() => true); // fail OPEN on Redis error — a missed overlap guard is safer than a stuck cron
  if (!acquired) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "previous Vector walls warm still in flight (idempotent skip)",
    };
    await logCronRun("vector-walls-warm", started, payload);
    return NextResponse.json(payload);
  }

  // Universe wall priming can exceed Cloudflare's ~100s origin timeout when caches are cold
  // (ops #2118: market_hours_stale with no fresh cron_job_runs row). Mirror vector-bead-record /
  // vector-full-state-snapshot: handshake in seconds, warming in after().
  //
  // UW sweep tag: intentionally NOT wrapped in the shared background UW sweep helper. This cron is
  // Polygon/GEX-cache heavy (warmVectorWalls → getVectorGexWalls/VexWalls). joinGexStrikeExpiryTicker
  // only registers a lightweight UW WS subscription — no UW REST fan-out — so it does not compete
  // with live traffic the way desk-warm / meridian-warm / vector-universe-snapshot do.
  const dispatchWarming = () => {
    void runVectorWallsWarm(started).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/vector-walls-warm] background warm REJECTED: ${detail}`);
    });
  };

  try {
    after(dispatchWarming);
  } catch {
    dispatchWarming();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "Vector walls warm dispatched in background",
  };
  await logCronRun("vector-walls-warm", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "EventBridge floors at 5/min; rth-warm-leader backs up at ~20s — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
