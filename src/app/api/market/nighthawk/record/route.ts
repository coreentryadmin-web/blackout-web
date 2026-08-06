import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { getNighthawkMetrics, type NighthawkRecordSegment } from "@/features/nighthawk/lib/analytics";
import type { NightHawkRecordSegmentWire } from "@/features/nighthawk/lib/types";
import { wilsonLowerBound, wilsonUpperBound } from "@/lib/swing/calibration";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;


const pct = (v: number) => Math.round(v * 1000) / 10;

function segmentWire(seg: NighthawkRecordSegment): NightHawkRecordSegmentWire {
  return {
    methodology: seg.methodology,
    label: seg.label,
    resolved: seg.resolved,
    scoreable: seg.scoreable,
    wins: seg.wins,
    losses: seg.losses,
    opens: seg.opens,
    ambiguous: seg.ambiguous,
    unfilled: seg.unfilled,
    pulled: seg.pulled,
    stop_data_unavailable: seg.stop_data_unavailable,
    win_rate_pct: seg.win_rate != null ? pct(seg.win_rate) : null,
    win_rate_ci_low_pct: seg.scoreable > 0 ? pct(wilsonLowerBound(seg.wins, seg.scoreable)) : null,
    win_rate_ci_high_pct: seg.scoreable > 0 ? pct(wilsonUpperBound(seg.wins, seg.scoreable)) : null,
    avg_return_pct: seg.avg_return_pct != null ? Math.round(seg.avg_return_pct * 100) / 100 : null,
    low_n: seg.low_n,
  };
}

/** User-facing Night Hawk track record — resolved play outcomes only.
 *
 *  PR-N2 record honesty: the headline ratios (win_rate_pct etc.) cover CURRENT-
 *  methodology scoreable rows only (analytics.ts computes them that way — this route
 *  adds nothing). Legacy-methodology rows are served as their own `segments.legacy`
 *  block, labeled, never blended: the pre-fix blend advertised 42.9% WR built on
 *  gap-away "wins" that were unfillable at the published entry band. */
export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  try {
    const windowDays = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? "30") || 30));
    const metrics = await getNighthawkMetrics(windowDays);

    return NextResponse.json(
      {
        window_days: metrics.window_days,
        total_resolved: metrics.total_resolved,
        pending_count: metrics.pending_count,
        win_rate_pct: pct(metrics.win_rate),
        win_rate_ci_low_pct: metrics.segments.current.scoreable > 0
          ? pct(wilsonLowerBound(metrics.segments.current.wins, metrics.segments.current.scoreable))
          : null,
        win_rate_ci_high_pct: metrics.segments.current.scoreable > 0
          ? pct(wilsonUpperBound(metrics.segments.current.wins, metrics.segments.current.scoreable))
          : null,
        profitable_rate_pct: pct(metrics.profitable_rate),
        avg_return_pct: Math.round(metrics.avg_return_pct * 100) / 100,
        // FILL-EDGE basis — the price a member could actually transact at (band edge, not
        // midpoint). This is the honest series and UIs render it as primary; the mid-basis
        // fields above are retained in parallel for one window because they are the basis
        // the live record and every historical audit were computed on (analytics.ts
        // realizedReturnPctEdge). Measured gap: ~+1.12pp per play in the mid figure's favour.
        avg_return_pct_edge: Math.round(metrics.avg_return_pct_edge * 100) / 100,
        profitable_rate_edge_pct: pct(metrics.profitable_rate_edge),
        methodology: metrics.methodology,
        unfilled_count: metrics.unfilled_count,
        pulled_count: metrics.pulled_count,
        stop_data_unavailable_count: metrics.stop_data_unavailable_count,
        segments: {
          current: segmentWire(metrics.segments.current),
          legacy: segmentWire(metrics.segments.legacy),
        },
        debrief: metrics.debrief,
        by_conviction: metrics.by_conviction
          .filter((c) => c.n > 0)
          .map((c) => {
            const wins = c.win_rate != null ? Math.round(c.win_rate * c.n) : 0;
            return {
              conviction: c.conviction,
              n: c.n,
              win_rate_pct: c.win_rate != null ? pct(c.win_rate) : null,
              win_rate_ci_low_pct: c.n > 0 && c.win_rate != null ? pct(wilsonLowerBound(wins, c.n)) : null,
              win_rate_ci_high_pct: c.n > 0 && c.win_rate != null ? pct(wilsonUpperBound(wins, c.n)) : null,
              low_n: c.low_n,
            };
          }),
        available: metrics.total_resolved > 0,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error("[nighthawk/record] unhandled error:", err);
    return NextResponse.json(
      { available: false, error: "Record temporarily unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
