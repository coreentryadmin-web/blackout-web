import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { runVectorPickUniverseSweep } from "@/lib/vector/vector-pick-sweep";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Cross-replica overlap guard. Measured live on prod 2026-09-01: a single sweep took
 * elapsed=301362ms (5m1s) against a schedule of every 2 minutes during RTH
 * (`schedule_cron_utc: "1-59/2 11-21 * * 1-5"`, cron-registry.ts) — this cron had NO overlap
 * guard, so the very next scheduled fire lands while the previous run is still in flight, on
 * whichever ECS task the ALB happens to route it to. Both instances then sweep the ~84-ticker
 * universe concurrently through the SAME cluster-wide Polygon/UW rate limiters
 * (GLOBAL_MAX_RPS=2, GLOBAL_MAX_CONCURRENCY=2-3 — uw-rate-limiter.ts / polygon-rate-limiter.ts)
 * that real member requests also depend on, worsening exactly the queueing tail
 * queue-budget.ts's own header describes (ALB TargetResponseTime p99 40-111s measured in this
 * same window, 2026-09-01 20:00-22:00 UTC — CloudWatch). Same `sharedCacheSetNx` idempotent-skip
 * pattern already used by swing-discovery/banger-discovery/thermal-discord for this exact
 * problem shape.
 *
 * TTL RAISED 2026-09-03 (480s -> 900s): the original 480s TTL was picked to match this cron's
 * `stale_after_min: 8` alerting threshold, but CloudWatch (2026-09-03 16:50-19:15 UTC RTH window)
 * showed real sweeps running LONGER than that TTL — elapsed=693684ms and 644588ms, both above the
 * 480s lock lifetime. When a sweep outlives its own lock, the lock expires mid-run and the NEXT
 * scheduled fire acquires it and starts a second sweep while the first is still in flight — the
 * exact overlap this guard exists to prevent, confirmed by log timestamps: a sweep that started
 * ~16:55:38 (finishing 17:06:52, elapsed=693684ms) had its lock expire at ~17:03:38, letting a
 * second sweep start ~17:05:16 and finish 17:09:31 while the first was still running. The two then
 * contend for the SAME rate-limited Polygon/UW clients this guard was built to protect, which is
 * the likely reason runtimes climbed further above the 2026-09-01 baseline instead of settling
 * back down. 900s gives real margin above the worst observed 694s without materially weakening the
 * safety net (a genuinely crashed/stuck sweep still self-heals within 15 minutes instead of never).
 * `stale_after_min` in cron-registry.ts is raised to 15 to match, per this file's own stated intent
 * of keeping the two in lockstep.
 */
const OVERLAP_LOCK_KEY = "vector:pick-sweep:running";
const OVERLAP_LOCK_TTL_SEC = 900;

async function runPickSweep(started: number): Promise<void> {
  try {
    const summary = await runVectorPickUniverseSweep();
    console.info(
      `[cron/vector-pick-sweep] done session=${summary.sessionDate} tickers=${summary.tickersAttempted} ` +
        `green=${summary.green} skip=${summary.skip} amber=${summary.amber} red=${summary.red} ` +
        `leaders=${summary.leadersWritten} closures=${summary.closuresLogged} elapsed=${Date.now() - started}ms`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[cron/vector-pick-sweep] REJECTED: ${detail}`);
  } finally {
    await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined);
  }
}

/** Server-side Vector contract-pick sweep — ranks + live-evaluates universe tickers without a desk viewer. */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-pick-sweep", started, payload);
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
      reason: "previous sweep still in flight (idempotent skip)",
    };
    await logCronRun("vector-pick-sweep", started, payload);
    return NextResponse.json(payload);
  }

  const dispatch = () => {
    void runPickSweep(started);
  };

  try {
    after(dispatch);
  } catch {
    dispatch();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "Vector pick universe sweep dispatched in background",
  };
  await logCronRun("vector-pick-sweep", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Evaluates ranked contract picks for every Vector universe ticker; writes leaders + Don't buy closures.",
    },
    { status: 202 }
  );
}
