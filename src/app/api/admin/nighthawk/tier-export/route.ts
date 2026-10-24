// GET /api/admin/nighthawk/tier-export — admin-only per-play export carrying the `score` a real
// score-calibration study needs (the tier-narrative-staleness idea logged 2026-09-15 in
// docs/audit/nighthawk-legacy-live-journal.json's knownOpenItems: every play's tier factor text
// cites a hardcoded, one-time '+2.99% avg' historical measurement, first committed 2026-07-17 and
// never recalibrated against the live closed-position population).
//
// The public /api/market/nighthawk/record route (analytics.ts's getNighthawkMetrics) only ever
// returns AGGREGATE stats — it drops `score` per play, so a real calibration study (does a play
// scored 42 actually win at the rate the narrative claims — mirroring the swing lane's own
// swing-score-calibration.mjs) has no per-row input to bucket. `score`/`conviction` already exist
// on every NighthawkPlayOutcomeRow (src/lib/db.ts's fetchNighthawkOutcomeAnalytics), they were
// just never exposed past analytics.ts's aggregation. This route exposes them directly,
// admin-gated read-only, mirroring the identical precedent the 0DTE lane already set
// (GET /api/admin/zerodte/tier-export, src/lib/zerodte/tier-export.ts, Task #59).
//
// Per-row shaping lives in the pure, unit-tested buildNighthawkTierExportRow (tier-export.ts) —
// this route only fetches and serializes.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchNighthawkOutcomeAnalytics, requireDatabaseInProduction } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { buildNighthawkTierExportRow } from "@/features/nighthawk/lib/tier-export";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

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
    const { rows } = await fetchNighthawkOutcomeAnalytics(days);
    const plays = rows.map(buildNighthawkTierExportRow);
    return NextResponse.json(roundFloats({ days, plays }), { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/tier-export", error);
    return NextResponse.json({ error: "Failed to load Night Hawk tier export" }, { status: 502 });
  }
}
