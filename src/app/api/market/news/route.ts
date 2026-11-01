import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";
import { serverCache, TTL } from "@/lib/server-cache";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!polygonConfigured()) {
    return NextResponse.json({ error: "Market data unavailable", articles: [] }, { status: 503 });
  }

  // This route is gated by `authorizeMarketDeskApi` — a paid community-tier (or
  // premium/cron) session is required to reach it at all. It PREVIOUSLY set
  // `Cache-Control: public, s-maxage=120` — a SHARED/public cache directive — which
  // tells Cloudflare (and any other intermediary) it may serve the exact same response
  // to a DIFFERENT, unauthenticated-or-lower-tier requester for up to 120s without ever
  // re-running the auth check above. That is the identical CWE-863 shape
  // `authorizeMarketDeskApi`'s own doc comment describes for the 20 premium routes that
  // were wired to the wrong tier gate: the API layer is the sole enforcement point
  // (middleware only matches page paths), so a cache that ignores the auth boundary IS
  // the vulnerability, not a performance tweak. Every sibling `authorizeMarketDeskApi`/
  // `authorizePremiumDeskApi` route in this codebase uses the canonical `NO_STORE_HEADERS`
  // (see that module's own "do not copy-paste inline Cache-Control blocks on new
  // auth-gated... routes" warning) — this was the one outlier. Upstream load is still
  // bounded: `serverCache` below already dedupes concurrent/rapid Benzinga calls across
  // EVERY requester process-wide for the same TTL window, so dropping the edge-cache
  // header does not reopen the "every poll hits Benzinga" problem it was trying to solve.
  try {
    const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim() || undefined;
    if (ticker) {
      // Use Benzinga's native tickers.any_of filter — returns all market coverage for this
      // stock: earnings, analyst calls, news mentions, sector commentary that names the ticker.
      // This is far broader than a post-fetch client-side filter on the tickers[] array.
      const cacheKey = `news:benzinga:ticker:${ticker}`;
      // TTL is in MILLISECONDS. This previously passed `60` (60ms — intended as 60s),
      // so ticker-mode news was effectively uncached and every member poll hit
      // Benzinga upstream directly.
      const articles = await serverCache(cacheKey, TTL.TICKER_NEWS, () => fetchBenzingaNews(50, { ticker }));
      return NextResponse.json({ source: "news", ticker, articles }, { headers: NO_STORE_HEADERS });
    }
    const articles = await serverCache("news:benzinga:15", TTL.NEWS, () => fetchBenzingaNews(15));
    return NextResponse.json({ source: "news", articles }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/news]", error);
    return NextResponse.json({ error: "News fetch failed" }, { status: 502 });
  }
}
