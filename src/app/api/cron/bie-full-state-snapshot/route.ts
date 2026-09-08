import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { buildBieFullState } from "@/lib/bie/full-platform-snapshot";
import { runWithBackgroundUwSweep } from "@/lib/providers/uw-rate-limiter";

// 24/7 full-platform snapshot — the "brain of BlackOut" feed (task #54).
//
// Every RTH tick this assembles the broad cross-product platform state (SPX desk + flow tape +
// Night Hawk via getPlatformSnapshot, the market-regime intel snapshot, the Vector universe wall
// summary, market-wide dark pool, hot tickers) and writes it to Redis (bie:full-state) so BIE reads
// current whole-platform state instantly. Mirrors the vector-universe-snapshot cron's shape
// (isCronAuthorized + RTH gate + force + logCronRun). Each loader is fail-open inside
// buildBieFullState, so a partial outage still writes a useful, honestly-annotated snapshot.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runBieFullStateSnapshot(started: number): Promise<void> {
  try {
    const state = await buildBieFullState();
    console.info(
      `[cron/bie-full-state-snapshot] background done — wrote=${["platform", "intel", "vectorUniverse", "darkPool", "hotTickers"].filter(
        (k) => (state as unknown as Record<string, unknown>)[k] != null
      ).join(",")} loaderErrors=${Object.keys(state.errors).length} elapsed=${Date.now() - started}ms`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[cron/bie-full-state-snapshot] background REJECTED: ${detail}`);
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
    await logCronRun("bie-full-state-snapshot", started, payload);
    return NextResponse.json(payload);
  }

  // buildBieFullState() fans out across desk/GEX/Vector loaders and can exceed Cloudflare's
  // ~100s origin timeout when caches are cold — mirror zerodte-warm's fire-and-forget handshake.
  //
  // Tagged as a background sweep (runWithBackgroundUwSweep) so it always leaves at least one
  // UW concurrency slot reachable for live member traffic even while mid-run — see
  // uw-rate-limiter.ts's block comment for the measured ALB tail-latency evidence.
  const dispatchSnapshot = () => {
    void runWithBackgroundUwSweep(() => runBieFullStateSnapshot(started)).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/bie-full-state-snapshot] background snapshot REJECTED: ${detail}`);
    });
  };

  try {
    after(dispatchSnapshot);
  } catch {
    dispatchSnapshot();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "BIE full-state snapshot dispatched in background (fire-and-forget)",
  };
  await logCronRun("bie-full-state-snapshot", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Cross-product snapshot build runs in background — cron handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
