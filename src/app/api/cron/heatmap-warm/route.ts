// Cron: pre-warm the shared GEX heatmap matrix cache for the ~11 Heat Maps presets.
// Schedule: ~every 20-30s during market hours (registered in cron-registry.ts as
// "heatmap-warm"; Railway wires the actual fire via railway.heatmap-warm.toml).
//
// THE POINT: the Heat Maps UI / Largo explain / gex-positioning all read fetchGexHeatmap(ticker),
// which dedups per ticker through the in-memory + Redis matrix cache (and a single-flight guard).
// Today the presets are warmed only by ORGANIC traffic, so a TTL expiry under burst causes a
// cold-build spike (N users racing N chain fetches before the cache fills). This cron warms each
// preset ONCE per tick so user-facing reads stay pure cache hits and the cold-build burst never
// happens. All upstream calls flow through the permissive Polygon rate-limiter, so a warm burst
// can't trip the 429 breaker on the live desk / GEX path. UW overlays are primed per allowlisted
// ticker after each matrix warm so member GETs skip overlay cold-fetch too.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { vectorWarmTickers, heatmapPresetTickers } from "@/lib/heatmap-allowlist";
import { primeGexOverlays } from "@/lib/gex-overlay";
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
      reason: "Outside cash RTH (weekday 9:30 AM–4:00 PM ET, excluding holidays/early-close) — use ?force=1 to override",
    };
    await logCronRun("heatmap-warm", started, payload);
    return NextResponse.json(payload);
  }

  const tickers = vectorWarmTickers();
  const presetSet = new Set(heatmapPresetTickers());

  // Presets first — SPX Slayer / Thermal paint before the long tail of extra-liquid names.
  const ordered = [
    ...tickers.filter((t) => presetSet.has(t)),
    ...tickers.filter((t) => !presetSet.has(t)),
  ];

  const results = await Promise.allSettled(
    ordered.map(async (t) => {
      const hm = await fetchGexHeatmap(t);
      if (hm?.strikes?.length) await primeGexOverlays(t, hm.strikes);
    })
  );

  let warmed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") warmed += 1;
  }
  const failed = results.length - warmed;
  if (failed > 0) {
    console.warn(`[cron/heatmap-warm] ${failed} preset warm(s) failed`);
  }

  // ok:false (=> failed status + critical alert) only when the WHOLE batch fails; a partial
  // failure logs ok with the count so one flaky underlying doesn't page ops.
  const allFailed = tickers.length > 0 && failed === tickers.length;
  await logCronRun("heatmap-warm", started, {
    ok: !allFailed,
    warmed,
    failed,
    total: tickers.length,
    ...(failed > 0 ? { error: `${failed}/${tickers.length} preset warm(s) failed` } : {}),
  });

  return NextResponse.json({ ok: true, warmed, total: tickers.length });
}
