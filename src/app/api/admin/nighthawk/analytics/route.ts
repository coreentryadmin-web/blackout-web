import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { getNighthawkMetrics } from "@/features/nighthawk/lib/analytics";
import { buildNighthawkDebriefReport } from "@/features/nighthawk/lib/debrief-aggregate";
import { getBangerScaleOutTrackRecord } from "@/features/nighthawk/lib/banger-track-record";

export const dynamic = "force-dynamic";

function parseWindow(value: string | null): number {
  const parsed = Number.parseInt(value ?? "30", 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(180, Math.max(7, parsed));
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const windowDays = parseWindow(request.nextUrl.searchParams.get("window"));

  try {
    // PR-N10: the full debrief report rides on this route (not a new one) — the admin
    // dashboard already reads it, the auth surface already exists, and the improvement
    // queue / gate counterfactuals are ops evidence about thresholds (admin material;
    // the member record route carries only the compact summary). Fetched in parallel;
    // buildNighthawkDebriefReport is fail-soft (an outage degrades to available:false,
    // never a 502 for the metrics half).
    // Step-6b: the read-only BANGER scale-out track record + graduation verdict rides on this same admin
    // route (auth already exists; it's ops evidence about whether the live managed exit has earned
    // activation). Fail-soft — a read outage degrades that section to null, never a 502 for metrics. The
    // 120-day window is independent of the metrics window: the banger grade needs the option's full forward
    // window (up to ~9 days) before it's pinned, so it accrues on a slower clock.
    const [metrics, debriefReport, bangerScaleOut] = await Promise.all([
      getNighthawkMetrics(windowDays),
      buildNighthawkDebriefReport({ days: windowDays, nowMs: Date.now() }),
      getBangerScaleOutTrackRecord(120).catch(() => null),
    ]);
    return NextResponse.json(
      { ...metrics, debrief_report: debriefReport, banger_scale_out: bangerScaleOut },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/analytics", error);
    return NextResponse.json({ error: "Failed to load Night Hawk analytics" }, { status: 502 });
  }
}
