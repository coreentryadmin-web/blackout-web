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
    decided: seg.decided,
    win_rate_pct: seg.win_rate != null ? pct(seg.win_rate) : null,
    // Wilson n = DECIDED, not scoreable. Feeding it `scoreable` made the interval as
    // falsely tight as the point estimate was falsely low: 0/22 → [0%, 14.9%] reads
    // "we are 95% confident this product wins under 15% of the time" off two decided
    // outcomes. The honest interval on 0/2 is [0%, 65.8%].
    win_rate_ci_low_pct: seg.decided > 0 ? pct(wilsonLowerBound(seg.wins, seg.decided)) : null,
    win_rate_ci_high_pct: seg.decided > 0 ? pct(wilsonUpperBound(seg.wins, seg.decided)) : null,
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
        // null (never 0) when nothing decided — a served 0 renders as "every play lost."
        win_rate_pct: metrics.win_rate != null ? pct(metrics.win_rate) : null,
        // Shipped so no client has to guess which population produced the rate: quote
        // decided_count beside win_rate_pct, and opens_count to explain the rest.
        decided_count: metrics.decided_count,
        opens_count: metrics.opens_count,
        low_n: metrics.low_n,
        win_rate_ci_low_pct: metrics.decided_count > 0
          ? pct(wilsonLowerBound(metrics.segments.current.wins, metrics.decided_count))
          : null,
        win_rate_ci_high_pct: metrics.decided_count > 0
          ? pct(wilsonUpperBound(metrics.segments.current.wins, metrics.decided_count))
          : null,
        profitable_rate_pct: pct(metrics.profitable_rate),
        avg_return_pct: Math.round(metrics.avg_return_pct * 100) / 100,
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
            // Back-derive the win count off DECIDED (the denominator the rate was computed
            // over) — multiplying by `c.n` against a decided-based rate would fabricate wins.
            const wins = c.win_rate != null ? Math.round(c.win_rate * c.decided) : 0;
            return {
              conviction: c.conviction,
              n: c.n,
              decided: c.decided,
              opens: c.opens,
              win_rate_pct: c.win_rate != null ? pct(c.win_rate) : null,
              win_rate_ci_low_pct: c.decided > 0 ? pct(wilsonLowerBound(wins, c.decided)) : null,
              win_rate_ci_high_pct: c.decided > 0 ? pct(wilsonUpperBound(wins, c.decided)) : null,
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
