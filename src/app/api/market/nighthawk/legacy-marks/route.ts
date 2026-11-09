import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import {
  fetchLegacyOptionMarksServer,
  type LegacyServerOptionMark as LegacyOptionMarkRow,
} from "@/features/nighthawk/lib/legacy-option-marks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { LegacyOptionMarkRow };

/** Live option marks for Legacy edition contracts — WS-first, REST snapshot fallback, with a
 *  Redis cache fallback (stale:true) when both sources fail for an OCC with a prior successful
 *  fetch. Delegates to fetchLegacyOptionMarksServer (the same function the legacy-live-sync cron
 *  and Discord trade-notify use) rather than reimplementing the WS+REST+cache logic here —
 *  the two previously diverged (found 2026-11-07, live audit): this route had its own inline
 *  copy with no cache fallback, so a provider outage dropped a position's mark to null here even
 *  though the cron-side copy would have served a stale-but-present cached value for the same OCC.
 *  Query: ?occs=NVDA260822C00500000,AMD260815C00120000 (max 12). */
export async function GET(req: NextRequest) {
  const auth = await authorizeCronOrTierApi(req, "premium");
  if (auth instanceof Response) return auth;
  if (auth.via === "user") {
    const denied = await requireToolApi("nighthawk");
    if (denied) return denied;
  }

  const raw = req.nextUrl.searchParams.get("occs") ?? "";
  const occs = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 12);
  if (!occs.length) {
    return NextResponse.json({ available: false, marks: [] }, { headers: NO_STORE_HEADERS });
  }

  const result = await fetchLegacyOptionMarksServer(occs, { includeStale: true });
  const marks: LegacyOptionMarkRow[] = [...result.values()];

  // BUG FIX (Ask Largo standing mandate, 2026-11-09): `available` used to be hardcoded `true`
  // whenever occs.length > 0, independent of whether any OCC actually resolved a mark — so a
  // total WS+REST+cache miss (every mark absent) still reported `available:true` with an empty
  // array. The only live HTTP consumer (use-legacy-option-marks.ts) never reads this field, so
  // today this was a latent footgun rather than an active bug — but `available` should mean "a
  // live mark was found," not "a well-formed query was supplied" (that half is already covered
  // by the `occs.length === 0` branch above).
  return NextResponse.json(roundFloats({ available: marks.length > 0, marks }), { headers: NO_STORE_HEADERS });
}
