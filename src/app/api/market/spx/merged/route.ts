import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { marketPlatform } from "@/lib/platform";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/** Merged SPX Sniper desk — pulse + flow + full desk (same feed as dashboard & play engine). */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  try {
    const [{ merged, pulse, flow }, platform] = await Promise.all([
      loadMergedSpxDesk(),
      marketPlatform.nighthawk.getLatestNightHawkSummary().catch(() => null),
    ]);
    return NextResponse.json(
      roundFloats({
        merged,
        pulse_available: pulse?.available ?? false,
        flow_available: flow?.available ?? false,
        platform_refs: {
          nighthawk: platform,
        },
      }),
      {
        headers: NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    console.error("[market/spx/merged]", error);
    return NextResponse.json({ available: false, error: "Merged desk build failed" }, { status: 502 });
  }
}
