// GET /api/admin/nighthawk/command-center — admin-only morning command-center table (operator
// priority #14, 2026-09-18 continuous-learning mandate, Phase 2F part 2). Wires
// buildCommandCenterTable (command-center-table.ts, the pure safe-half composer shipped in #6005)
// to the four live sources it was designed around:
//  - ACTIVE: resolveNighthawkEdition's own plays — the SAME member-facing, overlay-applied
//    (pulled/morning-confirm) plays the public edition route serves, not a raw pre-overlay row.
//  - WATCHING/REJECTED: buildCandidateLeaderboard over today's nighthawk_candidate_snapshot rows
//    (Phase 2D, #5187/#5197).
//  - MARKET REGIME: only a ticker's `discovery`-stage row carries the full `market_regime` object
//    in its snapshot_json (every later stage keeps only the scalar regime_multiplier) — same read
//    pattern rank-bucket-analysis-extended.ts's buildDiscoveryRowIndex already established. The
//    regime is captured ONCE per edition build, so any discovery row's copy is the edition's own.
//  - SYSTEM CONFIDENCE: the /record route's existing by-conviction Wilson CI (getNighthawkMetrics
//    + wilsonLowerBound/wilsonUpperBound), same back-derivation-of-wins-off-decided the /record
//    route itself uses (never off `n`, which also counts opens — that would fabricate wins).
//
// `edition_for` defaults to the edition actually SERVED right now (resolveNighthawkEdition's own
// served_for/carry-until-close logic) rather than the raw "tomorrow's date" request, which can be
// ahead of what candidate_snapshot rows exist for mid-session. `days` (default 30, same as
// /record) controls the SYSTEM CONFIDENCE window independently of which edition is shown.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { fetchNighthawkCandidateSnapshots, requireDatabaseInProduction, type NighthawkCandidateSnapshotRow } from "@/lib/db";
import { resolveNighthawkEdition } from "@/features/nighthawk/lib/resolve-edition";
import { nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import { buildCandidateLeaderboard } from "@/features/nighthawk/lib/candidate-leaderboard";
import { buildCommandCenterTable, type ConvictionConfidenceRow } from "@/features/nighthawk/lib/command-center-table";
import type { MarketRegimeTag } from "@/features/nighthawk/lib/market-regime";
import { getNighthawkMetrics } from "@/features/nighthawk/lib/analytics";
import { wilsonLowerBound, wilsonUpperBound } from "@/lib/swing/calibration";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pct = (v: number) => Math.round(v * 1000) / 10;

function confidenceRows(byConviction: Awaited<ReturnType<typeof getNighthawkMetrics>>["by_conviction"]): ConvictionConfidenceRow[] {
  return byConviction
    .filter((c) => c.n > 0)
    .map((c) => {
      // Same back-derivation the /record route uses: wins off DECIDED (the Wilson denominator),
      // never off `n` (which also counts opens) -- multiplying by n would fabricate wins.
      const wins = c.win_rate != null ? Math.round(c.win_rate * c.decided) : 0;
      return {
        conviction: c.conviction,
        n: c.n,
        win_rate_pct: c.win_rate != null ? pct(c.win_rate) : null,
        win_rate_ci_low_pct: c.decided > 0 ? pct(wilsonLowerBound(wins, c.decided)) : null,
        win_rate_ci_high_pct: c.decided > 0 ? pct(wilsonUpperBound(wins, c.decided)) : null,
      };
    });
}

/** See the module header's MARKET REGIME note — only a `discovery`-stage row carries the full
 *  object, and it's identical across every ticker's discovery row for one edition build, so the
 *  first one found is the edition's own tag. Null, never guessed, when no such row exists yet. */
function regimeFromSnapshotRows(rows: readonly NighthawkCandidateSnapshotRow[]): MarketRegimeTag | null {
  const discoveryRow = rows.find((r) => r.stage === "discovery" && r.snapshot_json?.market_regime);
  return (discoveryRow?.snapshot_json?.market_regime as MarketRegimeTag | undefined) ?? null;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const explicitDate = req.nextUrl.searchParams.get("edition_for");
    const requestedEditionFor = explicitDate ?? nextTradingDayEt(todayEt());
    const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? "30") || 30));

    const [edition, metrics] = await Promise.all([
      resolveNighthawkEdition(requestedEditionFor, explicitDate),
      getNighthawkMetrics(days),
    ]);

    // The edition actually SERVED (carry-until-close can serve yesterday's edition_for while
    // today's hasn't published yet) is the right key for candidate_snapshot rows -- not the raw
    // requested date, which can be ahead of what the pipeline has built rows for yet.
    const servedEditionFor = edition.served_for ?? edition.edition_for ?? requestedEditionFor;
    const snapshotRows = servedEditionFor
      ? await fetchNighthawkCandidateSnapshots(servedEditionFor)
      : [];

    const table = buildCommandCenterTable({
      plays: edition.plays,
      leaderboard: buildCandidateLeaderboard(snapshotRows),
      marketRegime: regimeFromSnapshotRows(snapshotRows),
      confidence: confidenceRows(metrics.by_conviction),
    });

    return NextResponse.json(roundFloats({ edition_for: servedEditionFor, ...table }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/command-center", error);
    return NextResponse.json({ error: "Failed to load Night Hawk command center" }, { status: 502 });
  }
}
