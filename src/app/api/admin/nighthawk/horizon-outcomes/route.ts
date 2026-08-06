// GET /api/admin/nighthawk/horizon-outcomes — the unified cross-lane outcomes read layer
// (backlog item #29), admin-gated. Mirrors admin/nighthawk/analytics's auth pattern
// (requireAdminApi) since this is the same ops-reporting surface family: cross-lane
// evidence for admins, not a member-facing product route. All aggregation/mapping logic
// lives in src/lib/horizon-outcomes.ts (pure per-row mappers, unit-tested); this route only
// parses ?days/?lane and shapes the response. READ-ONLY — no writes, no new tables.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { requireDatabaseInProduction } from "@/lib/db";
import { fetchUnifiedHorizonOutcomes } from "@/lib/horizon-outcomes";
import type { Horizon } from "@/lib/horizons";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const VALID_LANES: ReadonlySet<string> = new Set<Horizon>(["ZERO_DTE", "SWING", "LEAPS"]);

function parseDays(value: string | null): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_DAYS), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, parsed));
}

function parseLane(value: string | null): Horizon | undefined {
  return value != null && VALID_LANES.has(value) ? (value as Horizon) : undefined;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = parseDays(req.nextUrl.searchParams.get("days"));
  const lane = parseLane(req.nextUrl.searchParams.get("lane"));

  try {
    const outcomes = await fetchUnifiedHorizonOutcomes({ days, lane });
    return NextResponse.json({ days, lane: lane ?? null, outcomes }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/horizon-outcomes", error);
    return NextResponse.json({ error: "Failed to load unified horizon outcomes" }, { status: 502 });
  }
}
