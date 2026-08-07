import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { getNighthawkMetrics } from "@/features/nighthawk/lib/analytics";
import { roundFloats } from "@/lib/round-floats";
import { buildNighthawkDebriefReport } from "@/features/nighthawk/lib/debrief-aggregate";
import { getBangerScaleOutTrackRecord } from "@/features/nighthawk/lib/banger-track-record";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

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
    // Round at the response boundary like every sibling route (nighthawk/edition/route.ts:210,
    // nighthawk/horizons/route.ts:70). This lane was the one that never did, and served raw IEEE
    // floats to the admin UI: avg_return_pct 0.4696125545466665, avg_loser_return_pct
    // -9.648441937634674, segments.legacy.avg_return_pct 0.012000911084166713 (live 2026-08-07).
    //
    // The `*_rate` fields need a per-key override, NOT the 2dp default — they are FRACTIONS of one
    // (profitable_rate 0.667, loss_rate 0.074, open_rate 0.926), and 2dp quantizes them to the
    // nearest 1%. That is precisely the defect fixed on the Vector expected-move route (#1867),
    // where a blanket 2dp turned a 0.004 fraction into a literal 0. Percent-scale fields
    // (avg_return_pct, *_pct) are genuine percentages and 2dp is right for them.
    return NextResponse.json(
      roundFloats(
        { ...metrics, debrief_report: debriefReport, banger_scale_out: bangerScaleOut },
        2,
        { profitable_rate: 4, loss_rate: 4, open_rate: 4, profitable_rate_edge: 4, loss_rate_edge: 4 }
      ),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/analytics", error);
    return NextResponse.json({ error: "Failed to load Night Hawk analytics" }, { status: 502 });
  }
}
