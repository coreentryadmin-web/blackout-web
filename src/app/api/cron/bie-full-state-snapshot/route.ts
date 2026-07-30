import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { buildBieFullState } from "@/lib/bie/full-platform-snapshot";

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

  try {
    const dispatchBuild = () => {
      void buildBieFullState()
        .then((state) => {
          console.info(
            `[cron/bie-full-state-snapshot] background done — asOf=${state.asOf} errors=${Object.keys(state.errors).length} elapsed=${Date.now() - started}ms`
          );
        })
        .catch((err) => {
          console.error(
            "[cron/bie-full-state-snapshot] background build REJECTED:",
            err instanceof Error ? err.message : err
          );
        });
    };

    try {
      after(dispatchBuild);
    } catch {
      dispatchBuild();
    }

    const accepted = {
      ok: true,
      status: "accepted",
      reason: "full-platform snapshot dispatched in background (fire-and-forget)",
    };
    await logCronRun("bie-full-state-snapshot", started, accepted);
    return NextResponse.json(
      {
        ...accepted,
        note: "Heavy build runs in background — bie:full-state still advances on the ECS worker.",
      },
      { status: 202 }
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await logCronRun("bie-full-state-snapshot", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "bie-full-state-snapshot failed" }, { status: 500 });
  }
}
