// GET /api/admin/nighthawk/score-signal-analysis — admin-only diagnostic read for the operator-
// directed Phase 1 (completed-trade) + Phase 2 (early-read) score/flow-dominance investigation
// (2026-09-23), the properly-scoped follow-on after the 04:45Z wrong-direction finding was
// self-corrected (see docs/audit/nighthawk-legacy-live-journal.json's 05:26Z correction entry).
// Both phases are returned in ONE payload but are structurally separate report objects — never
// blend Phase 1's realized-trade-profitability claim with Phase 2's early-directional-read claim.
// READ-ONLY, zero effect on live scoring/ranking. Reuses db.fetchNighthawkOutcomeAnalytics(days) —
// the SAME fetch debrief-aggregate.ts's own buildNighthawkDebriefReport and
// direction-failure-diagnosis's route already use — so this route needs no new DB query.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { dbConfigured, fetchNighthawkOutcomeAnalytics, requireDatabaseInProduction } from "@/lib/db";
import { isCurrentGradeMethodology } from "@/features/nighthawk/lib/grade-methodology";
import { analyzePhase1CompletedTrades, analyzePhase2EarlyRead } from "@/features/nighthawk/lib/score-signal-analysis";
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
        roundFloats({ phase1: analyzePhase1CompletedTrades([], days), phase2: analyzePhase2EarlyRead([], days) }),
        { headers: NO_STORE_HEADERS }
      );
    }
    const { rows } = await fetchNighthawkOutcomeAnalytics(days);
    // Same #333 anti-blend rule as every other debrief-aggregate cut: legacy-methodology rows are
    // excluded rather than silently blended into a report that reads as one methodology.
    const current = rows.filter((r) => isCurrentGradeMethodology(r.grade_methodology));
    const phase1 = analyzePhase1CompletedTrades(current, days);
    const phase2 = analyzePhase2EarlyRead(current, days);
    return NextResponse.json(roundFloats({ phase1, phase2 }), { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/score-signal-analysis", error);
    return NextResponse.json({ error: "Failed to load Night Hawk score-signal analysis" }, { status: 502 });
  }
}
