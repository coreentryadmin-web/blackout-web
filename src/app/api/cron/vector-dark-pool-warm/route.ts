import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { warmVectorDarkPool } from "@/features/vector/lib/vector-dark-pool-cache";
import { isEtCashRth } from "@/lib/et-market-hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function runVectorDarkPoolWarm(started: number): Promise<void> {
  const tickers = vectorUniverseTickers();
  const results = await Promise.allSettled(tickers.map((t) => warmVectorDarkPool(t)));

  let warmed = 0;
  let levels = 0;
  let fetchFailed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.fetchFailed) {
        fetchFailed += 1;
      } else {
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
}

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

  const dispatchWarm = () => {
    void runVectorDarkPoolWarm(started).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/vector-dark-pool-warm] background warm REJECTED: ${detail}`);
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
    reason: "vector dark-pool warm dispatched in background (fire-and-forget)",
    total: vectorUniverseTickers().length,
  };
  await logCronRun("vector-dark-pool-warm", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Per-ticker UW dark-pool cache writes run in background — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
