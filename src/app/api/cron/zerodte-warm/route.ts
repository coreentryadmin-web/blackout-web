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
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Cross-replica overlap guard. Measured live on prod 2026-09-02: two "[cron/zerodte-warm]
 * background done" completions logged 2.171s apart (15:28:37.606 and 15:28:39.777 UTC) with
 * elapsed=168371ms and elapsed=123934ms — their runtimes overlapped for 100+ seconds of
 * concurrent execution on shared web-tier ECS compute. This route has TWO independent,
 * uncoordinated trigger sources — EventBridge's own ~5min schedule AND the in-app
 * rth-warm-leader (rth-warm-leader.ts), which re-dispatches this key the instant its last
 * recorded run is more than 4 minutes stale (RTH_WRITER_HEAL_AFTER_MIN["zerodte-warm"]) — with
 * no lock between them, so a fast EventBridge fire and a leader-triggered heal-fire can land
 * within seconds of each other while the prior run's scanner tick + board-snapshot rebuild is
 * still in flight, doubling load on the same rate-limited HELIX/UW upstreams and DB writes real
 * member requests also depend on. Same `sharedCacheSetNx` idempotent-skip pattern already used
 * by vector-pick-sweep and desk-warm for this exact problem shape. TTL (900s) matches this
 * cron's own `stale_after_min: 15` alerting threshold (cron-registry.ts) as the safety-net
 * ceiling if a release is ever missed.
 */
const OVERLAP_LOCK_KEY = "zerodte-warm:running";
const OVERLAP_LOCK_TTL_SEC = 900;

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

  const acquired = await sharedCacheSetNx(
    OVERLAP_LOCK_KEY,
    { startedAt: started },
    OVERLAP_LOCK_TTL_SEC
  ).catch(() => true); // fail OPEN on a Redis error — a missed overlap guard is safer than a stuck cron
  if (!acquired) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "previous zerodte warm still in flight (idempotent skip)",
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
      })
      .finally(() => {
        void sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined);
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
