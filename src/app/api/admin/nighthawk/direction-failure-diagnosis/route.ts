// GET /api/admin/nighthawk/direction-failure-diagnosis — admin-only diagnostic read for the
// operator-directed wrong_direction investigation (2026-09-23): trace every wrong_direction
// graded play against a comparison cohort of real winners, using ONLY already-pinned evidence
// (publish_context's confluence score breakdown, regime, tier, gate-promotion, target-ATR
// multiple). READ-ONLY, zero effect on live scoring/ranking — same pattern as
// candidate-leaderboard/rank-bucket-analysis: fetch -> pure classify -> roundFloats -> JSON.
//
// Reuses db.fetchNighthawkOutcomeAnalytics(days) — the SAME fetch debrief-aggregate.ts's own
// buildNighthawkDebriefReport already uses — so this route needs no new DB query.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { dbConfigured, fetchNighthawkOutcomeAnalytics, requireDatabaseInProduction } from "@/lib/db";
import { isCurrentGradeMethodology } from "@/features/nighthawk/lib/grade-methodology";
import { diagnoseDirectionFailures } from "@/features/nighthawk/lib/direction-failure-diagnosis";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_DAYS = 90;
const MAX_DAYS = 180;

function parseDays(value: string | null): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_DAYS), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, parsed));
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = parseDays(req.nextUrl.searchParams.get("days"));

  try {
    if (!dbConfigured()) {
      return NextResponse.json(
        roundFloats(diagnoseDirectionFailures([], days)),
        { headers: NO_STORE_HEADERS }
      );
    }
    const { rows } = await fetchNighthawkOutcomeAnalytics(days);
    // Same #333 anti-blend rule as every other debrief-aggregate cut: legacy-methodology rows
    // are excluded rather than silently blended into a report that reads as one methodology.
    const current = rows.filter((r) => isCurrentGradeMethodology(r.grade_methodology));
    const report = diagnoseDirectionFailures(current, days);
    return NextResponse.json(roundFloats(report), { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/direction-failure-diagnosis", error);
    return NextResponse.json({ error: "Failed to load Night Hawk direction-failure diagnosis" }, { status: 502 });
  }
}
