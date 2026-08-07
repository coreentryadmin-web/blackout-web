import { NextRequest, NextResponse } from "next/server";
import { buildPublicTrackRecord } from "@/lib/track-record-public";
import { getClientIp, checkIpRateLimit, rateLimitHeaders } from "@/lib/ip-rate-limit";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

// Public, unauthenticated, rate-limited aggregate ledger — powers /track-record
// and the embeddable widget. Deliberately sanitized at the source
// (buildPublicTrackRecord / PublicTrackRecord is documented as "the ONLY shape
// allowed to leave the server unauthenticated" — aggregate counts + win rates
// only, never per-trade rows, prices, or dates) so this route is safe to expose
// without auth. Re-published 2026-08 after a period as admin-only; see
// docs/marketing/SEO-GROWTH.md finding #2.
export const runtime = "nodejs";
// Must stay live with /api/market/spx/outcomes + /api/track-record — a 5m ISR cache
// caused split-brain when a play closed mid-RTH (public=7 vs outcomes=8).
export const dynamic = "force-dynamic";


// 30 requests per 60s per IP: generous for an embed widget (polls every 60-120s),
// but blocks automated scraping that would hammer this unauthenticated endpoint.
const RATE_LIMIT = 30;
const RATE_WINDOW_SECS = 60;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkIpRateLimit(ip, "public:track-record", RATE_LIMIT, RATE_WINDOW_SECS);
  const rlHeaders = rateLimitHeaders(rl);

  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { ...NO_STORE_HEADERS, ...rlHeaders } }
    );
  }

  const record = await buildPublicTrackRecord();
  return NextResponse.json(roundFloats(record), { headers: { ...NO_STORE_HEADERS, ...rlHeaders } });
}
