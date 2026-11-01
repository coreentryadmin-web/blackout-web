// Cron: pre-warm general platform caches during the extended warm window.
// Schedule: every 5 minutes, 24 hours/day (EventBridge), but execution is gated to weekday
// trading days 4:00 AM–8:00 PM ET via shouldRunCacheWarmer — same as desk/heatmap/zerodte warmers.
//
// THE POINT: The platform bootstrap bundle (loaded by many admin/member pages outside market
// hours) is UW-bound (~2–5s cold). This cron keeps the bootstrap cache warm so off-hours
// page loads (night Hawk edge, early BIE lookups) don't block on expensive rebuilds.

import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { loadBootstrapBundle } from "@/features/spx/lib/spx-desk-loader";
import { runWithBackgroundUwSweep } from "@/lib/providers/uw-rate-limiter";
import { callerInfoFromRequest, shouldRunCacheWarmer } from "@/lib/cache-warmer-gate";
import { isEtExtendedWarmHours } from "@/lib/et-market-hours";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Cross-replica overlap guard. platform-warm shares the same ~5min EventBridge schedule band as
 * desk-warm, zerodte-warm, meridian-warm, and swing-active-refresh (FINDINGS 2026-09-02 ALB
 * tail-latency chain). Without a lock, concurrent invocations fan out the same UW-bound warm work
 * on every web-tier replica. Same `sharedCacheSetNx` idempotent-skip pattern as meridian-warm.
 * TTL (600s) matches this cron's own `stale_after_min: 10` safety-net ceiling.
 */
const OVERLAP_LOCK_KEY = "platform-warm:running";
const OVERLAP_LOCK_TTL_SEC = 600;

/**
 * Minimum re-run floor for `?force=1` — independent of the hours gate above.
 *
 * OVERLAP_LOCK only guards against a SECOND run starting while the FIRST is still in flight and
 * releases the instant that run completes. On an already-warm platform cache the background pass
 * can finish far faster than a cold rebuild, so a caller replaying `?force=1` in a tight loop
 * could re-trigger the same UW-bound warm work far faster than any legitimate trigger ever
 * would — same structural gap fixed on desk-warm (#3540), heatmap-warm (#3542), meridian-warm.
 *
 * 60s sits safely BELOW every legitimate cadence: rth-warm-leader's heal threshold for this key
 * is 5 min (RTH_WRITER_HEAL_AFTER_MIN["platform-warm"]) and EventBridge's own schedule is ~5 min.
 */
const RERUN_COOLDOWN_KEY = "platform-warm:cooldown";
const RERUN_COOLDOWN_SEC = 60;
/** Wider floor for repeated `?force=1` calls outside the extended warm window — same gap fixed on desk-warm (#4558). */
const OFF_WINDOW_FORCE_COOLDOWN_SEC = 300;

async function runPlatformWarm(started: number): Promise<void> {
  try {
    const bootstrapResult = await Promise.allSettled([loadBootstrapBundle()]);
    const bootstrapOk = bootstrapResult[0].status === "fulfilled";
    if (!bootstrapOk) {
      console.warn(
        "[cron/platform-warm] background loadBootstrapBundle failed:",
        bootstrapResult[0].status === "rejected" ? bootstrapResult[0].reason : "unknown"
      );
    } else {
      console.info(`[cron/platform-warm] background done — elapsed=${Date.now() - started}ms`);
    }
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
  if (!shouldRunCacheWarmer(force, undefined, "platform-warm", callerInfoFromRequest(req))) {
    const skipped = { ok: true, status: "skipped", reason: "off-hours gate" };
    await logCronRun("platform-warm", started, skipped);
    return NextResponse.json(skipped);
  }

  const effectiveCooldownSec = isEtExtendedWarmHours()
    ? RERUN_COOLDOWN_SEC
    : OFF_WINDOW_FORCE_COOLDOWN_SEC;
  const withinCooldown = !(await sharedCacheSetNx(
    RERUN_COOLDOWN_KEY,
    { startedAt: started },
    effectiveCooldownSec
  ).catch(() => true));
  if (withinCooldown) {
    const payload = {
      ok: true,
      skipped: true,
      reason: `rate-limited — platform-warm already ran within the last ${effectiveCooldownSec}s (force=1 does not bypass this floor)`,
    };
    await logCronRun("platform-warm", started, payload);
    return NextResponse.json(payload);
  }

  const acquired = await sharedCacheSetNx(
    OVERLAP_LOCK_KEY,
    { startedAt: started },
    OVERLAP_LOCK_TTL_SEC
  ).catch(() => true); // fail OPEN on Redis error — a missed overlap guard is safer than a stuck cron
  if (!acquired) {
    const skipped = {
      ok: true,
      skipped: true,
      reason: "previous platform warm still in flight (idempotent skip)",
    };
    await logCronRun("platform-warm", started, skipped);
    return NextResponse.json(skipped);
  }

  const dispatchWarm = () => {
    void runWithBackgroundUwSweep(() => runPlatformWarm(started)).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/platform-warm] background warm REJECTED: ${detail}`);
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
    reason: "platform bootstrap warm dispatched in background (fire-and-forget)",
  };
  await logCronRun("platform-warm", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Bootstrap bundle rebuild runs in background — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
