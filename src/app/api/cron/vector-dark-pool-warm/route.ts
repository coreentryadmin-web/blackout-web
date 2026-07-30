import { NextRequest, NextResponse, after } from "next/server";
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
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-dark-pool-warm", started, payload);
    return NextResponse.json(payload);
  }

  const tickers = vectorUniverseTickers();

  const dispatchWarm = () => {
    void Promise.allSettled(tickers.map((t) => warmVectorDarkPool(t)))
      .then((results) => {
        let warmed = 0;
        let levels = 0;
        let fetchFailed = 0;
        for (const r of results) {
          if (r.status === "fulfilled") {
            if (r.value.fetchFailed) fetchFailed += 1;
            else {
              warmed += 1;
              levels += r.value.levels;
            }
          }
        }
        const rejected = results.length - warmed - fetchFailed;
        const failed = fetchFailed + rejected;
        console.info(
          `[cron/vector-dark-pool-warm] background done — warmed=${warmed} failed=${failed} levels=${levels} elapsed=${Date.now() - started}ms`
        );
        if (failed > 0) {
          console.warn(`[cron/vector-dark-pool-warm] background: ${failed}/${results.length} warm(s) failed`);
        }
      })
      .catch((err) => {
        console.error("[cron/vector-dark-pool-warm] background warm REJECTED:", err);
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
    reason: "vector dark pool warm dispatched in background (fire-and-forget)",
    total: tickers.length,
  };
  await logCronRun("vector-dark-pool-warm", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Heavy warm runs in background — Vector dark pool cache still advances on the ECS worker.",
    },
    { status: 202 }
  );
}
