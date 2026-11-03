import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { todayEt } from "@/features/nighthawk/lib/session";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { runNighthawkBackfillRepairJob } from "@/features/nighthawk/lib/nighthawk-backfill-repair-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  const today = todayEt(new Date(started));
  const editionDateParam = req.nextUrl.searchParams.get("date") ?? today;

  const { httpStatus, payload } = await runNighthawkBackfillRepairJob({
    started,
    editionDateParam,
    force,
  });
  return NextResponse.json(payload, { status: httpStatus });
}
