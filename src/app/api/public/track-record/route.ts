import { NextResponse } from "next/server";
import { buildPublicTrackRecord } from "@/lib/track-record-public";

// PUBLIC route by design: it intentionally calls NONE of the self-guard helpers
// (requireTierApi / authorizeMarketDeskApi / isCronAuthorized). See the security
// contract in src/middleware.ts — public-ness is an explicit per-handler choice.
// Output is the sanitized, PII-free aggregate from buildPublicTrackRecord().
export const runtime = "nodejs";
// Cache at the edge: this is aggregate social proof, not live data.
export const revalidate = 300;

export async function GET() {
  const record = await buildPublicTrackRecord();
  return NextResponse.json(record, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
