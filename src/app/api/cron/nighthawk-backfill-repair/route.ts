// Cron: NIGHT HAWK BACKFILL REPAIR — self-heals a stale BACKFILL contract on today's already-
// published Legacy edition, before market open. ALSO (added after the 2026-11-02/2026-10-28
// starved-funnel recurrence — see the `no_rank_governor_snapshot` branch below): when the
// backfill mechanism has no candidate pool to draw from at all because the evening build never
// reached ranking (100% dossier-fetch collapse), dispatches ONE last-resort full pipeline
// rebuild before market open, since nothing else does.
//
// FIRES: 13:00 + 14:00 UTC Mon-Fri (dual-band, same shape as nighthawk-morning-confirm) — 9:00 AM
// ET in both DST regimes, 15 minutes BEFORE morning-confirm's own 9:15 AM ET run, so morning-
// confirm (which reads the edition row fresh from the DB and explicitly documents "the edition
// ROW is still never mutated" by ITS OWN logic — see that route's header comment) always sees
// whatever this route has already repaired.
//
// PRODUCTION DISPATCH (2026-11-03): EventBridge still lacks the standalone rule (blackout-infra
// cron-jobs.json entry never applied). Until that lands, the same pass runs at the START of
// nighthawk-morning-confirm (deployed schedule) via runNighthawkBackfillRepairPass() — see
// backfill-repair-pass.ts. The dedicated route remains for manual/?force=1 and future EventBridge.
//
// WHY THIS EXISTS (Ask Largo standing mandate, live repro 2026-10-25): PR #6637 (2026-10-24)
// shipped `repairStaleBackfillContracts`/`republishBackfilledEdition` (post-publish-backfill.ts)
// specifically to re-pick or drop a BACKFILL play whose own option contract has already expired
// relative to the edition's target trading day — but that function is ONLY ever invoked via the
// admin-only, manually-triggered `POST /api/admin/nighthawk/republish-backfill`. Nothing calls it
// automatically. This cron is that caller.
//
// AUTH: Bearer CRON_SECRET (isCronAuthorized). force-dynamic.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { todayEt } from "@/features/nighthawk/lib/session";
import { runNighthawkBackfillRepairPass } from "@/features/nighthawk/lib/backfill-repair-pass";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  const today = todayEt();
  const editionDateParam = req.nextUrl.searchParams.get("date") ?? today;

  const { payload, httpStatus } = await runNighthawkBackfillRepairPass({
    force,
    editionDateParam,
  });
  return NextResponse.json(payload, { status: httpStatus });
}
