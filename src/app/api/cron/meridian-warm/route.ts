import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { warmMeridianCaches } from "@/lib/meridian/meridian-snapshot";
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
  if (!shouldRunCacheWarmer(force)) {
    const skipped = { ok: true, status: "skipped", reason: "off-hours gate" };
    await logCronRun("meridian-warm", started, skipped);
    return NextResponse.json(skipped);
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
    void runMeridianWarm(started).catch((error) => {
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
