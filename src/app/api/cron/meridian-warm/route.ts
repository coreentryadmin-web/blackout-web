import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { warmMeridianCaches } from "@/lib/meridian/meridian-snapshot";
import { runWithBackgroundUwSweep } from "@/lib/providers/uw-rate-limiter";
import { shouldRunCacheWarmer } from "@/lib/cache-warmer-gate";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Cross-replica overlap guard. meridian-warm shares the same ~5min EventBridge schedule band as
 * desk-warm, zerodte-warm, and swing-active-refresh (FINDINGS 2026-09-02 ALB tail-latency chain).
 * Without a lock, concurrent invocations fan out the same Polygon/UW-bound warm work on every
 * web-tier replica. Same `sharedCacheSetNx` idempotent-skip pattern as desk-warm/zerodte-warm.
 * TTL (600s) matches this cron's own `stale_after_min: 10` safety-net ceiling.
 */
const OVERLAP_LOCK_KEY = "meridian-warm:running";
const OVERLAP_LOCK_TTL_SEC = 600;

/**
 * Minimum re-run floor for `?force=1` — independent of the hours gate above.
 *
 * OVERLAP_LOCK only guards against a SECOND run starting while the FIRST is still in flight and
 * releases the instant that run completes. On an already-warm Meridian cache the background pass
 * can finish far faster than a cold sweep, so a caller replaying `?force=1` in a tight loop could
 * re-trigger the same Polygon/UW-bound warm work far faster than any legitimate trigger ever
 * would — the exact structural gap #3540 fixed on desk-warm and #3542 on heatmap-warm.
 *
 * 60s sits safely BELOW every legitimate cadence: rth-warm-leader's heal threshold for this key
 * is 5 min (RTH_WRITER_HEAL_AFTER_MIN["meridian-warm"]) and EventBridge's own schedule is ~5 min.
 */
const RERUN_COOLDOWN_KEY = "meridian-warm:cooldown";
const RERUN_COOLDOWN_SEC = 60;

async function runMeridianWarm(started: number): Promise<void> {
  try {
    const result = await warmMeridianCaches(21);
    console.info(
      `[cron/meridian-warm] done — timeline=${result.timeline_ok} gex=${result.gex_ok} desk=${result.desk_ok} elapsed=${Date.now() - started}ms`
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
  if (!shouldRunCacheWarmer(force, undefined, "meridian-warm")) {
    const skipped = { ok: true, status: "skipped", reason: "off-hours gate" };
    await logCronRun("meridian-warm", started, skipped);
    return NextResponse.json(skipped);
  }

  const withinCooldown = !(await sharedCacheSetNx(
    RERUN_COOLDOWN_KEY,
    { startedAt: started },
    RERUN_COOLDOWN_SEC
  ).catch(() => true));
  if (withinCooldown) {
    const payload = {
      ok: true,
      skipped: true,
      reason: `rate-limited — meridian-warm already ran within the last ${RERUN_COOLDOWN_SEC}s (force=1 does not bypass this floor)`,
    };
    await logCronRun("meridian-warm", started, payload);
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
      reason: "previous Meridian warm still in flight (idempotent skip)",
    };
    await logCronRun("meridian-warm", started, skipped);
    return NextResponse.json(skipped);
  }

  const dispatchWarm = () => {
    void runWithBackgroundUwSweep(() => runMeridianWarm(started)).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/meridian-warm] background warm REJECTED: ${detail}`);
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
    reason: "Meridian timeline + Polygon GEX + desk enrichment warm dispatched",
  };
  await logCronRun("meridian-warm", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Warm runs in background — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
