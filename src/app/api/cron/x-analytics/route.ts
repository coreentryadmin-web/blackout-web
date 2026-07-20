import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled } from "@/lib/x-api";
import { collectXAnalyticsSnapshot } from "@/lib/x-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!xApiEnabled()) {
    return NextResponse.json({ ok: false, reason: "X API not configured" });
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";

  try {
    if (dryRun) {
      await logCronRun("x-analytics", started, {
        ok: true,
        skipped: true,
        reason: "dry run",
      });
      return NextResponse.json({ ok: true, dryRun: true });
    }

    const snap = await collectXAnalyticsSnapshot();
    await logCronRun("x-analytics", started, { ok: true, ...snap });
    return NextResponse.json({ ok: true, snapshot: snap });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    await logCronRun("x-analytics", started, { ok: false, error: message });
    return NextResponse.json({ ok: false, error: message });
  }
}
