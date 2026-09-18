import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled } from "@/lib/x-api";
import { runMentionReplySweep } from "@/lib/x-mention-replies";
import { fetchMarketSnapshot } from "@/lib/x-content";
import { xMarketingPostsPaused, xMentionRepliesPaused } from "@/lib/x-marketing-env";
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
    return NextResponse.json({ ok: false, reason: "X API not configured" });
  }

  if (xMentionRepliesPaused()) {
    await logCronRun("x-replies", started, {
      ok: true,
      skipped: true,
      reason: xMarketingPostsPaused()
        ? "X_MARKETING_POSTS_PAUSED"
        : "X_MENTION_REPLIES_PAUSED",
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: xMarketingPostsPaused()
        ? "X_MARKETING_POSTS_PAUSED"
        : "X_MENTION_REPLIES_PAUSED",
    });
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const cronMode = req.nextUrl.searchParams.get("manual") !== "1";
  const force = req.nextUrl.searchParams.get("force") === "1";
  const sessionDay = todayEt(new Date(started));

  // No public mention replies with live-desk copy on NYSE holidays (weekday schedule only).
  if (!force && !isTradingDayEt(sessionDay)) {
    await logCronRun("x-replies", started, {
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
    const marketSnapshot = await fetchMarketSnapshot();
    const stats = await runMentionReplySweep({
      dryRun,
      cronMode,
      marketSnapshot,
    });
    await logCronRun("x-replies", started, {
      ok: true,
      dryRun,
      replied: stats.replied,
      scanned: stats.scanned,
      skippedCount: stats.skipped,
      errors: stats.errors,
      skippedReason: stats.skippedReason,
    });
    return NextResponse.json({ ok: true, dryRun, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    await logCronRun("x-replies", started, { ok: false, error: message });
    return NextResponse.json({ ok: false, error: "X replies failed" });
  }
}
