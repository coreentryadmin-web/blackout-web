import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled } from "@/lib/x-api";
import { runMentionReplySweep } from "@/lib/x-mention-replies";
import { fetchMarketSnapshot } from "@/lib/x-content";
import { xMarketingPostsPaused } from "@/lib/x-marketing-env";

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

  if (xMarketingPostsPaused()) {
    await logCronRun("x-replies", started, {
      ok: true,
      skipped: true,
      reason: "X_MARKETING_POSTS_PAUSED",
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "X_MARKETING_POSTS_PAUSED",
    });
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const cronMode = req.nextUrl.searchParams.get("manual") !== "1";

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
    return NextResponse.json({ ok: false, error: message });
  }
}
