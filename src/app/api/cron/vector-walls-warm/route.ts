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

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { listSharedUniverseTickers } from "@/features/vector/lib/vector-dynamic-universe";
import { warmVectorWalls, getTickersToWarmAsync } from "@/features/vector/lib/vector-walls-warm";
import { isEtCashRth } from "@/lib/et-market-hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  const tickers = await getTickersToWarmAsync(await listSharedUniverseTickers());

  // Warm all walls in parallel; settle all so one failing underlying can't abort the rest.
  const results = await Promise.allSettled(
    tickers.map((t) => warmVectorWalls(t))
  );

  let warmed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      warmed += 1;
    }
  }
  const failed = results.length - warmed;

  await logCronRun("vector-walls-warm", started, {
    ok: warmed > 0,
    warmed,
    failed,
    total: tickers.length,
  });

  return NextResponse.json({
    ok: true,
    warmed,
    total: tickers.length,
  });
}
