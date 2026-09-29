// GET /api/admin/nighthawk/candidate-coverage — admin-only diagnostic read answering the Phase 3
// question a 2026-09-23 evidence survey found genuinely missing: how many nighthawk_candidate_snapshot
// rows exist per stage/rejection_reason, and how many are forward-graded yet. READ-ONLY, zero
// effect on live scoring/ranking/capture. One new aggregate query (fetchNighthawkCandidateSnapshotCoverage,
// db.ts) -- a GROUP BY in Postgres rather than fetching every row and counting in JS, since `stage`
// is intentionally unconstrained free-text and a JS-side stage allowlist would silently
// under-report the moment a new stage tag ships on the write side.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { dbConfigured, fetchNighthawkCandidateSnapshotCoverage, requireDatabaseInProduction } from "@/lib/db";
import { buildCandidateCoverageReport } from "@/features/nighthawk/lib/candidate-coverage";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;

function parseDays(value: string | null): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_DAYS), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, parsed));
}

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = parseDays(req.nextUrl.searchParams.get("days"));

  try {
    if (!dbConfigured()) {
      return NextResponse.json(roundFloats(buildCandidateCoverageReport([], days)), { headers: NO_STORE_HEADERS });
    }
    const startDate = daysAgoYmd(days);
    const endDate = new Date().toISOString().slice(0, 10);
    const rows = await fetchNighthawkCandidateSnapshotCoverage(startDate, endDate);
    const report = buildCandidateCoverageReport(rows, days);
    return NextResponse.json(roundFloats(report), { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/candidate-coverage", error);
    return NextResponse.json({ error: "Failed to load Night Hawk candidate-snapshot coverage" }, { status: 502 });
  }
}
