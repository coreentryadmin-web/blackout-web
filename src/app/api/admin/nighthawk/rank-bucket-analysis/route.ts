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
//
// EXTENDED (2026-09-21, same diagnostic-only scope): median MFE/MAE, MFE:MAE ratio, large-
// winner/loser tail rate, confidence intervals, direction/conviction/setup-type segmentation,
// and rejected-winner/Top-5-loser tracing are computed unconditionally (pure, zero extra I/O —
// see rank-bucket-analysis-extended.ts) since they're derived from the exact same rows already
// fetched below. The one genuinely extra query is the fuller trend-regime join, which needs a
// separate `discovery`-stage fetch (the only stage carrying the full market_regime object) — it
// is opt-in via `include_discovery_regime=1` so a plain call pays no extra query cost.
// Query params (additive): large_move_threshold_pct=N, correlation only ever reports null below
// its own disclosed minimum n (no param needed), include_discovery_regime=1.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchNighthawkCandidateSnapshotsInRange, requireDatabaseInProduction, type NighthawkCandidateSnapshotRow } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { computeRankBucketStats, computeRegimeBucketStats } from "@/features/nighthawk/lib/rank-bucket-analysis";
import {
  computeExtendedRankBucketStats,
  computeRankOutcomeCorrelation,
  computeDirectionBucketStats,
  computeConvictionBucketStats,
  computeSetupTypeBucketStats,
  computeTrendRegimeBucketStats,
  buildDiscoveryRowIndex,
  findTop5Losers,
  findRejectedWinners,
  DEFAULT_LARGE_MOVE_THRESHOLD_PCT,
  type OutcomeMeasure,
} from "@/features/nighthawk/lib/rank-bucket-analysis-extended";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

const CORRELATION_MEASURES: OutcomeMeasure[] = ["h1", "eod", "mfe", "mae"];

function extendedReport(
  rows: readonly NighthawkCandidateSnapshotRow[],
  largeMoveThresholdPct: number,
  discoveryIndex: ReadonlyMap<string, NighthawkCandidateSnapshotRow> | null
) {
  return {
    rank_buckets: computeExtendedRankBucketStats(rows, { largeMoveThresholdPct }),
    rank_outcome_correlation: Object.fromEntries(
      CORRELATION_MEASURES.map((measure) => [measure, computeRankOutcomeCorrelation(rows, measure)])
    ),
    direction_buckets: computeDirectionBucketStats(rows),
    conviction_buckets: computeConvictionBucketStats(rows),
    setup_type_buckets: computeSetupTypeBucketStats(rows),
    trend_regime_buckets: discoveryIndex ? computeTrendRegimeBucketStats(rows, discoveryIndex) : null,
    top5_losers: findTop5Losers(rows, { adverseThresholdPct: largeMoveThresholdPct }),
    rejected_winners: findRejectedWinners(rows, { favorableThresholdPct: largeMoveThresholdPct }),
  };
}

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

    const largeMoveThresholdPctRaw = Number(params.get("large_move_threshold_pct"));
    const largeMoveThresholdPct =
      Number.isFinite(largeMoveThresholdPctRaw) && largeMoveThresholdPctRaw > 0
        ? largeMoveThresholdPctRaw
        : DEFAULT_LARGE_MOVE_THRESHOLD_PCT;
    const includeDiscoveryRegime = params.get("include_discovery_regime") === "1";

    const rows = await fetchNighthawkCandidateSnapshotsInRange(start, end);
    const recentRows = rows.filter((r) => r.edition_for >= recentStart);

    const editionsSeen = new Set(rows.map((r) => r.edition_for));
    const recentEditionsSeen = new Set(recentRows.map((r) => r.edition_for));

    // Opt-in extra fetch (the only stage carrying the full market_regime object) — omitted by
    // default so a plain call pays no extra query cost. recentRows is a strict subset of rows by
    // edition_for, so one discovery index covers both windows.
    const discoveryIndex = includeDiscoveryRegime
      ? buildDiscoveryRowIndex(await fetchNighthawkCandidateSnapshotsInRange(start, end, { stages: ["discovery"] }))
      : null;

    return NextResponse.json(
      roundFloats({
        window: { start, end, recent_start: recentStart, recent_days: recentDays, large_move_threshold_pct: largeMoveThresholdPct },
        baseline: {
          row_count: rows.length,
          edition_count: editionsSeen.size,
          editions: Array.from(editionsSeen).sort(),
          rank_buckets: computeRankBucketStats(rows),
          regime_buckets: computeRegimeBucketStats(rows),
          extended: extendedReport(rows, largeMoveThresholdPct, discoveryIndex),
        },
        recent: {
          row_count: recentRows.length,
          edition_count: recentEditionsSeen.size,
          editions: Array.from(recentEditionsSeen).sort(),
          rank_buckets: computeRankBucketStats(recentRows),
          regime_buckets: computeRegimeBucketStats(recentRows),
          extended: extendedReport(recentRows, largeMoveThresholdPct, discoveryIndex),
        },
      }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/rank-bucket-analysis", error);
    return NextResponse.json({ error: "Failed to compute Night Hawk rank-bucket analysis" }, { status: 502 });
  }
}
