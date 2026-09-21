// GET /api/admin/swing/multi-truth-grade — admin-only, READ-ONLY retrace of closed/rolled swing
// positions against the real multi-truth grader (`swing/grade.ts`'s `gradeSwingPosition` — EXECUTION/
// PATH/THESIS/MANAGEMENT/FINANCIAL). Raised on #4076 (comment 5751117208, "Swing's 5-truth grader is
// still completely unwired") after re-confirming against current `main`: `swing/grade.ts`'s real
// `gradeSwingPosition` has ZERO non-test production call sites. Every closed swing position members
// see is graded ONLY by `gradeParentFromMark`'s (roll-plan.ts) single point-in-time realized-P&L
// freeze, written to the same `grade_json` column this route reads but never writes to or replaces.
//
// This is the smallest of the three shapes floated on #4076 for closing that gap: additive,
// read-only, no member-facing surface touched, no schema change, no new cron/infra dependency (this
// sandbox has no path to deploy a new EventBridge rule — see CLAUDE.md's cron/terraform notes). It
// computes the 5-truth grade ON REQUEST from the SAME `swing_positions` row + real Polygon forward
// underlying bars, and returns it alongside the row's own frozen markfreeze `grade_json` so a caller
// can compare "the realized P&L number members saw" against "did the underlying thesis actually
// confirm, and how much of its real MFE/MAE did that P&L capture."
//
// SCOPE (see grade-retrace.ts's header for the full reasoning): only PATH + THESIS are populated —
// both gradeable from underlying bars alone, which this repo already fetches in production
// (`fetchStockDailyBars`). EXECUTION/FINANCIAL/MANAGEMENT report their own honest `ungradeable`
// verdict (no real fill price is ever recorded on this ledger; historical OPTION bars per position
// are not fetched this pass — a real follow-up, not silently skipped, since it needs a materially
// larger OCC-resolution + Polygon-options-aggregates lift with no existing production helper).
//
// Row shaping is a pure, unit-tested mapper (grade-retrace.ts); this route only fetches (DB rows +
// Polygon bars) and serializes.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchClosedSwingPositionsRange, requireDatabaseInProduction } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { fetchStockDailyBars } from "@/lib/providers/polygon";
import { gradeSwingPosition } from "@/lib/swing/grade";
import { swingBarWindow, swingRowToGradeInput } from "@/lib/swing/grade-retrace";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 120;
const MAX_ROWS = 200;
const BAR_FETCH_BATCH_SIZE = 10;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS)
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const rows = await fetchClosedSwingPositionsRange(since, MAX_ROWS);

    // Dedupe identical (ticker, from, to) bar-window fetches — several legs of one roll chain, or
    // several positions on the same ticker closed the same week, would otherwise re-fetch the same
    // Polygon range. Batched (not one giant Promise.all) to stay gentle on the Polygon rate limit.
    const barCache = new Map<string, Promise<Awaited<ReturnType<typeof fetchStockDailyBars>>>>();
    const barsFor = (ticker: string, from: string, to: string) => {
      const key = `${ticker}|${from}|${to}`;
      let cached = barCache.get(key);
      if (!cached) {
        cached = fetchStockDailyBars(ticker, from, to).catch(() => []);
        barCache.set(key, cached);
      }
      return cached;
    };

    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += BAR_FETCH_BATCH_SIZE) {
      const batch = rows.slice(i, i + BAR_FETCH_BATCH_SIZE);
      const graded = await Promise.all(
        batch.map(async (row) => {
          const window = swingBarWindow(row);
          const bars = window ? await barsFor(row.ticker, window.from, window.to) : [];
          const grade = gradeSwingPosition(swingRowToGradeInput(row, bars));
          return {
            positionId: row.id,
            rootPositionId: row.root_position_id,
            ticker: row.ticker,
            status: row.status,
            sessionDate: row.session_date,
            committedAt: row.committed_at,
            closedAt: row.closed_at,
            barWindow: window,
            barsFetched: bars.length,
            // The frozen markfreeze P&L members actually saw for this leg — unchanged, so a caller
            // can compare it directly against the multi-truth grade's own truths.
            markfreezeRealizedPnlPct: row.realized_pnl_pct,
            markfreezeGradeJson: row.grade_json,
            multiTruthGrade: grade,
          };
        })
      );
      results.push(...graded);
    }

    return NextResponse.json(
      roundFloats({ since, through: new Date().toISOString().slice(0, 10), days, count: results.length, rows: results }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    recordAdminRouteError("admin/swing/multi-truth-grade", error);
    return NextResponse.json({ error: "Failed to compute swing multi-truth grade retrace" }, { status: 502 });
  }
}
