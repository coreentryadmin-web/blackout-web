// Cron: warm 0DTE Command's earnings-match cache + run its always-on scanner tick.
// Schedule: ~every 1-5 min during market hours (registered in cron-registry.ts as
// "zerodte-warm"; EventBridge wires the actual fire).
//
// HISTORY (renamed 2026-07-07 when classic Grid was deleted): this route used to be
// "grid-warm" and pre-warmed 8 classic-Grid market-wide panel snapshots (Analyst Actions,
// Dark Pool, Congress, Economy, Sectors, Movers, Catalysts, Earnings) PLUS ran
// warmZeroDteBoard() as a 9th, unrelated item tacked onto the same Promise.allSettled tick.
// Classic Grid (the page, its 17 components, its 9 API routes) was deleted wholesale, but
// warmZeroDteBoard() is 0DTE Command's OWN always-on scanner tick — every ~2-min run scans
// the HELIX tape for fresh single-name 0DTE concentration and upserts the live session
// ledger (zerodte_setup_log). Deleting this route outright would have silently killed that
// scanner, so instead of deleting it, it's renamed and stripped down to ONLY the two things
// 0DTE Command actually needs: its earnings-match cache warm (readGridEarnings() in
// zerodte-service.ts flags setups reporting today/tomorrow) and the scanner tick itself.
//
// RTH-RESILIENCE (#90): market-hours cron services died mid-RTH before. This route self-skips off
// the in-process ET gate (so the cron can fire on a wide UTC band and the route decides) and logs
// every run via logCronRun, so the cron-staleness-watchdog catches a silent never-fired warmer.

import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { warmGridEarnings } from "@/lib/zerodte/earnings";
import { warmZeroDteBoard } from "@/lib/zerodte/scan";
import { refreshZeroDteBoardSnapshot } from "@/lib/platform/zerodte-service";
import { shouldRunCacheWarmer } from "@/lib/cache-warmer-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!shouldRunCacheWarmer(force)) {
    const payload = {
      ok: true,
      skipped: true,
      reason:
        "Outside extended warm window (weekday 4:00 AM–8:00 PM ET) — use ?force=1 or set CACHE_WARM_ALWAYS=1",
    };
    await logCronRun("zerodte-warm", started, payload);
    return NextResponse.json(payload);
  }

  // Earnings cache is fast — keep it in the handshake so the cron log proves the tick fired.
  const earningsResult = await Promise.allSettled([warmGridEarnings()]);
  const earningsWarmed =
    earningsResult[0]?.status === "fulfilled" && earningsResult[0].value != null ? 1 : 0;

  // Scanner tick + board snapshot rebuild routinely exceed Cloudflare's ~100s origin timeout when
  // awaited (RTH finding 2026-07-30: HTTP 504 on every probe). Mirror nighthawk-edition: dispatch
  // the heavy work in after() and return 202 in seconds. The ECS worker is long-lived — the build
  // still completes and publishes the shared snapshot; only the HTTP handshake must be short.
  const dispatchWarm = () => {
    void Promise.allSettled([warmZeroDteBoard(), refreshZeroDteBoardSnapshot()])
      .then((results) => {
        let warmed = earningsWarmed;
        for (const r of results) {
          if (r.status === "fulfilled" && r.value != null) warmed += 1;
        }
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          console.warn(`[cron/zerodte-warm] background: ${failed}/${results.length} warm(s) failed`);
        }
        console.info(
          `[cron/zerodte-warm] background done — warmed=${warmed} failed=${failed} elapsed=${Date.now() - started}ms`
        );
      })
      .catch((err) => {
        console.error("[cron/zerodte-warm] background warm REJECTED:", err);
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
    reason: "scanner + board snapshot dispatched in background (fire-and-forget)",
    warmed: earningsWarmed,
    total: 3,
  };
  await logCronRun("zerodte-warm", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Heavy warm runs in background — board snapshot still advances on the ECS worker.",
    },
    { status: 202 }
  );
}
