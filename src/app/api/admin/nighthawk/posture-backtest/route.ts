// GET /api/admin/nighthawk/posture-backtest — admin-only measurement of how often
// bearish-posture.ts's detectBookPosture() gate would have fired SHORT against real published
// history, cross-referenced with what the book actually published each evening.
//
// WHY THIS EXISTS (2026-09-18, live audit cycle, standing continuous-learning mandate's
// outcome-honesty pillar): a routine audit found Legacy's book was 47 LONG vs 1 SHORT over the
// last 30 sessions while SPY closed -1.31% with 17/22 red days, alongside `wrong_direction`
// being the dominant graded failure mode (47.6%) in the same window. bearish-posture.ts (PR-N9)
// already exists specifically to prevent an all-LONG book on a bearish tape, via a deliberately
// conservative >=2-of-3 signal gate — but nothing had ever measured its real historical fire
// rate. This route answers that, using data ALREADY durably pinned at publish time
// (publish-context.ts's `market` block on `nighthawk_play_outcomes.publish_context`) — zero new
// capture, zero schema change, zero live-picks-logic change. Pure measurement, same
// fetch->pure-shape->JSON pattern as candidate-leaderboard/tier-export.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchNighthawkOutcomeAnalytics, requireDatabaseInProduction } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { buildPostureBacktestReport } from "@/features/nighthawk/lib/posture-backtest";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const rawDays = Number(req.nextUrl.searchParams.get("days") ?? "30");
    const windowDays = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;

    const { rows } = await fetchNighthawkOutcomeAnalytics(windowDays);
    const report = buildPostureBacktestReport(rows);

    return NextResponse.json(roundFloats({ window_days: windowDays, ...report }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/posture-backtest", error);
    return NextResponse.json({ error: "Failed to load Night Hawk posture backtest" }, { status: 502 });
  }
}
