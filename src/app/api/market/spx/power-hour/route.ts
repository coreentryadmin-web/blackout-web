import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { readSpxPowerHourSnapshot } from "@/features/spx/lib/spx-power-hour-engine";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/** Read-only power-hour snapshot — mutation runs only via spx-evaluate cron. */
export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const { merged } = await loadMergedSpxDesk();
    const powerHour = await readSpxPowerHourSnapshot(merged);

    return NextResponse.json(
      roundFloats({
        available: true,
        as_of: merged.polled_at ?? new Date().toISOString(),
        power_hour: powerHour,
      }),
      {
        headers: NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    console.error("[market/spx/power-hour]", error);
    return NextResponse.json(
      { available: false, power_hour: null, error: "Power hour read failed" },
      { status: 502 }
    );
  }
}
