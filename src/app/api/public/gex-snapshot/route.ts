// Public, unauthenticated, rate-limited GEX snapshot — powers the /tools/gamma-snapshot
// lead magnet (docs/marketing/SEO-GROWTH.md finding #5). Ticker restricted to a small
// allowlist (SPX/SPY/QQQ) so this can't be used to scrape the full desk's ticker universe.
// Deliberately delayed (see buildPublicGexSnapshot's cache TTL) — this is marketing
// content, not the live product.
import { NextRequest, NextResponse } from "next/server";
import { buildPublicGexSnapshot, isPublicGexTicker } from "@/lib/public-gex-snapshot";
import { getClientIp, checkIpRateLimit, rateLimitHeaders } from "@/lib/ip-rate-limit";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 20;
const RATE_WINDOW_SECS = 60;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkIpRateLimit(ip, "public:gex-snapshot", RATE_LIMIT, RATE_WINDOW_SECS);
  const rlHeaders = rateLimitHeaders(rl);

  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { ...NO_STORE_HEADERS, ...rlHeaders } }
    );
  }

  const tickerParam = (req.nextUrl.searchParams.get("ticker") ?? "SPX").toUpperCase();
  if (!isPublicGexTicker(tickerParam)) {
    return NextResponse.json(
      { error: "Unsupported ticker — SPX, SPY, or QQQ only" },
      { status: 400, headers: { ...NO_STORE_HEADERS, ...rlHeaders } }
    );
  }

  const snapshot = await buildPublicGexSnapshot(tickerParam);
  return NextResponse.json(snapshot, { headers: { ...NO_STORE_HEADERS, ...rlHeaders } });
}
