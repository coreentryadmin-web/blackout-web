// GET /api/admin/nighthawk/rank-bucket-analysis — admin-only, READ-ONLY Phase-0 diagnostic:
// does Legacy's existing rank ordering actually carry forward-return predictive value, and are
// recent selections underperforming the longer-term baseline?
//
// WHY THIS EXISTS (2026-09-20, operator's "upgrade Legacy" mandate, explicitly scoped to
// "Phase 0 only... diagnosis only... Do not begin Phase 1"): the operator asked whether ranks
// 1-5 forward-perform better than 6-10/11-25/rejected, and whether recent Top-5 losses trace to
// ranking quality, market regime, setup selection, contract selection, or normal variance. The
// data substrate already exists (nighthawk_candidate_snapshot + candidate-forward-grade.ts's
// direction-agnostic multi-horizon forward returns/MFE/MAE, graded for BOTH published and
// rejected rows) — nobody had written the bucket-and-compare query before. This route is the
// pure compute in rank-bucket-analysis.ts (computeRankBucketStats/computeRegimeBucketStats),
// fed by the new additive read fetchNighthawkCandidateSnapshotsInRange (db.ts). No scoring,
// ranking, contract-selection, publishing, gate, or schema change — a read-only report layer.
//
// Two windows are computed so "is this a recent-only problem" is answerable directly:
//   - `baseline`: the full requested [start, end] range.
//   - `recent`: the last `recent_days` calendar days ending at `end` (a strict subset of
//     baseline, NOT an independent second query — the same rows, sliced by edition_for).
//
// Query params: start=YYYY-MM-DD, end=YYYY-MM-DD (defaults: end=today ET-naive UTC date,
// start=90 days before end), recent_days=N (default 10).
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchNighthawkCandidateSnapshotsInRange, requireDatabaseInProduction } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { computeRankBucketStats, computeRegimeBucketStats } from "@/features/nighthawk/lib/rank-bucket-analysis";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_RECENT_DAYS = 10;

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return isoDateOnly(d);
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const params = req.nextUrl.searchParams;
    const end = params.get("end") || isoDateOnly(new Date());
    const start = params.get("start") || daysBefore(end, DEFAULT_LOOKBACK_DAYS);
    const recentDaysRaw = Number(params.get("recent_days"));
    const recentDays = Number.isFinite(recentDaysRaw) && recentDaysRaw > 0 ? recentDaysRaw : DEFAULT_RECENT_DAYS;
    const recentStart = daysBefore(end, recentDays);

    const rows = await fetchNighthawkCandidateSnapshotsInRange(start, end);
    const recentRows = rows.filter((r) => r.edition_for >= recentStart);

    const editionsSeen = new Set(rows.map((r) => r.edition_for));
    const recentEditionsSeen = new Set(recentRows.map((r) => r.edition_for));

    return NextResponse.json(
      roundFloats({
        window: { start, end, recent_start: recentStart, recent_days: recentDays },
        baseline: {
          row_count: rows.length,
          edition_count: editionsSeen.size,
          editions: Array.from(editionsSeen).sort(),
          rank_buckets: computeRankBucketStats(rows),
          regime_buckets: computeRegimeBucketStats(rows),
        },
        recent: {
          row_count: recentRows.length,
          edition_count: recentEditionsSeen.size,
          editions: Array.from(recentEditionsSeen).sort(),
          rank_buckets: computeRankBucketStats(recentRows),
          regime_buckets: computeRegimeBucketStats(recentRows),
        },
      }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/rank-bucket-analysis", error);
    return NextResponse.json({ error: "Failed to compute Night Hawk rank-bucket analysis" }, { status: 502 });
  }
}
