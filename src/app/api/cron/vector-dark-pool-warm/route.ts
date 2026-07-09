import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { warmVectorDarkPool } from "@/features/vector/lib/vector-dark-pool-cache";
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
  const offHoursWarm = process.env.CACHE_WARM_OFF_HOURS?.trim() === "1";
  if (!force && !offHoursWarm && !isEtCashRth()) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside cash RTH — use ?force=1 or CACHE_WARM_OFF_HOURS=1",
    };
    await logCronRun("vector-dark-pool-warm", started, payload);
    return NextResponse.json(payload);
  }

  const tickers = vectorUniverseTickers();
  const results = await Promise.allSettled(tickers.map((t) => warmVectorDarkPool(t)));

  let warmed = 0;
  let levels = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      warmed += 1;
      levels += r.value;
    }
  }
  const failed = results.length - warmed;

  const payload = {
    ok: failed < results.length,
    warmed,
    failed,
    total: tickers.length,
    levels,
  };
  await logCronRun("vector-dark-pool-warm", started, payload);
  return NextResponse.json(payload);
}
