import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled } from "@/lib/x-api";
import { runGrowthSweep } from "@/lib/x-growth-engine";
import { xMarketingSilentOnly } from "@/lib/x-marketing-env";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import { todayEt } from "@/lib/et-date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!xApiEnabled()) {
    await logCronRun("x-growth", started, {
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
  const force = req.nextUrl.searchParams.get("force") === "1";
  const sessionDay = todayEt(new Date(started));
  const silentOnly =
    req.nextUrl.searchParams.get("silent") === "1" || xMarketingSilentOnly();

  // No FinTwit engagement sweeps on NYSE holidays (weekday schedule only).
  if (!force && !isTradingDayEt(sessionDay)) {
    await logCronRun("x-growth", started, {
      ok: true,
      skipped: true,
      reason: `non-trading day (${sessionDay})`,
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `non-trading day (${sessionDay})`,
    });
  }

  try {
    const stats = await runGrowthSweep({ dryRun, cronMode, silentOnly });

    await logCronRun("x-growth", started, {
      ok: true,
      dryRun,
      ...stats,
    });

    return NextResponse.json({ ok: true, dryRun, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logCronRun("x-growth", started, { ok: false, error: message });
    return NextResponse.json({ ok: false, error: "X growth failed" }, { status: 200 });
  }
}
