import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchIndexSnapshots } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";
import { serverCache, TTL } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import {
  overlayRestIndexWithWs,
  resolveLiveIndexWsEntry,
} from "@/lib/providers/index-snapshot-overlay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SPX = "I:SPX";
const VIX = "I:VIX";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!polygonConfigured()) {
    return NextResponse.json({ error: "Market data unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  try {
    // Capture the sample time INSIDE the cached loader so `as_of` reflects when the
    // upstream snapshot was actually fetched — not response-build time. serverCache is
    // stale-while-revalidate (up to MAX_STALE_AGE_MS=10min), so stamping `new Date()` at
    // serve time would label minutes-old cached data as real-time. Threading the fetch
    // timestamp through the cache makes a consumer's `as_of` honest about freshness.
    const cached = await serverCache("indices:spx-vix", TTL.MARKET_SNAPSHOT, async () => {
      const data = await fetchIndexSnapshots([SPX, VIX]);
      return { snaps: data, fetched_at: new Date().toISOString() };
    });
    let spx = cached.snaps[SPX];
    let vix = cached.snaps[VIX];

    // Overlay fresher indices-WS ticks (I:SPX / I:VIX) — NOT stock-candle-store A.* ticks.
    // Stock candles anchor day-change to session open; indices WS + REST snapshots anchor to the
    // official prior close (what Polygon's session.change_percent and data-validator ground on).
    const [spxWs, vixWs] = await Promise.all([
      resolveLiveIndexWsEntry(SPX),
      resolveLiveIndexWsEntry(VIX),
    ]);
    if (spx) spx = overlayRestIndexWithWs(spx, spxWs);
    if (vix) vix = overlayRestIndexWithWs(vix, vixWs);

    if (!spx && !vix) {
      return NextResponse.json(
        { error: "Index data temporarily unavailable" },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      roundFloats({
        source: "market",
        as_of: cached.fetched_at,
        spx,
        vix,
      }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[market/indices]", error);
    return NextResponse.json({ error: "Index fetch failed" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
