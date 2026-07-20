import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled } from "@/lib/x-api";
import { runEngagementSweep } from "@/lib/x-engage-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!xApiEnabled()) {
    await logCronRun("x-engage", started, {
      ok: false,
      skipped: true,
      reason: "X API credentials not configured",
    });
    return NextResponse.json(
      { ok: false, reason: "X API credentials not configured" },
      { status: 200 },
    );
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const cronMode = req.nextUrl.searchParams.get("manual") !== "1";

  try {
    const stats = await runEngagementSweep({ dryRun, cronMode });

    await logCronRun("x-engage", started, {
      ok: true,
      dryRun,
      ...stats,
    });

    return NextResponse.json({ ok: true, dryRun, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logCronRun("x-engage", started, { ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
