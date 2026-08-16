import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { warmMeridianCaches } from "@/lib/meridian/meridian-snapshot";
import { shouldRunCacheWarmer } from "@/lib/cache-warmer-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

async function runMeridianWarm(started: number): Promise<void> {
  const result = await warmMeridianCaches(21);
  console.info(
    `[cron/meridian-warm] done — timeline=${result.timeline_ok} gex=${result.gex_ok} desk=${result.desk_ok} elapsed=${Date.now() - started}ms`
  );
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
