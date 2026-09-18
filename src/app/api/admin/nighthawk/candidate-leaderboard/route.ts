// GET /api/admin/nighthawk/candidate-leaderboard — admin-only per-ticker rank-trajectory export
// for one Legacy edition's candidate funnel (discovery -> scored -> rank_governor ->
// rank_final/rejected).
//
// WHY THIS EXISTS (2026-09-18, operator's "upgrade Legacy" continuous-learning mandate, priority
// #7 — "Create a candidate leaderboard that records how rankings change... continuously
// reranked"): PR #5187 shipped the pure compute primitive (candidate-leaderboard.ts's
// buildCandidateLeaderboard) but never wired it to a reader, so the trajectory it computes from
// nighthawk_candidate_snapshot (already flowing since PR #5184/#5188 closed shadow-tracking
// coverage) had nowhere to surface. This route exposes it directly, admin-gated read-only, same
// pattern as tier-export/rejection-export (fetch -> pure row-shaper -> roundFloats -> JSON).
//
// `edition_for` defaults to the latest PUBLISHED edition (fetchLatestNighthawkEdition) when
// omitted — the candidate_snapshot table's own rows can exist for a date with no edition row yet
// (e.g. mid-build), but "the latest edition members actually saw" is the more useful default for
// an ad-hoc admin lookup than "today's ET date", which could be a date whose build hasn't run.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchNighthawkCandidateSnapshots, fetchLatestNighthawkEdition, requireDatabaseInProduction } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { buildCandidateLeaderboard } from "@/features/nighthawk/lib/candidate-leaderboard";
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
    let editionFor = req.nextUrl.searchParams.get("edition_for");
    if (!editionFor) {
      const latest = await fetchLatestNighthawkEdition();
      if (!latest) {
        return NextResponse.json(roundFloats({ edition_for: null, count: 0, leaderboard: [] }), {
          headers: NO_STORE_HEADERS,
        });
      }
      editionFor = latest.edition_for;
    }

    const rows = await fetchNighthawkCandidateSnapshots(editionFor);
    const leaderboard = buildCandidateLeaderboard(rows);
    return NextResponse.json(
      roundFloats({ edition_for: editionFor, count: leaderboard.length, leaderboard }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/candidate-leaderboard", error);
    return NextResponse.json({ error: "Failed to load Night Hawk candidate leaderboard" }, { status: 502 });
  }
}
