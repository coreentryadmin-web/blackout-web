import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { getVectorPinForecast } from "@/features/vector/lib/vector-pin-forecast-server";
import type { ForecastTargetKind } from "@/features/vector/lib/vector-forecast-target";
import { roundFloats } from "@/lib/round-floats";
import { VECTOR_FRACTION_DP } from "@/features/vector/lib/vector-response-rounding";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pin/magnet forecast for ANY Vector ticker — the SPX desk's EOD cone, generalized.
 *
 * Same gate as the sibling reads (authorizeMarketDeskApi + requireToolApi("vector") + ticker
 * allowlist), and kept OFF the per-second SSE payload like the walls / ladder / expected-move reads
 * so the shared per-ticker stream stays lean: the client fetches once per ticker/target toggle.
 *
 * `?target=eod|expiry` (default `expiry`). "eod" projects today's close; "expiry" projects the
 * nearest forward expiry's close. The default is `expiry` because it is the horizon that is
 * meaningful on EVERY name — only SPX/SPY/QQQ have a daily expiry to make "eod" a pin rather than
 * a gamma-pull reading, and the resolver caveats it accordingly on the others.
 *
 * `forecast: null` whenever there is no honest cone to draw (no spot, empty/one-sided chain, no
 * forward expiry, target close already passed). Floats rounded at the data layer per repo policy —
 * with {@link VECTOR_FRACTION_DP} for the 0..1 fields. The core deliberately emits `pinPct` and
 * `magnet.strengthPct` at `toFixed(3)`; a blanket 2dp at the boundary silently threw that third
 * digit away and floored a sub-1% `scenarios[].p` to zero.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const ticker = normalizeVectorTicker(rawTicker);
  // Anything other than an exact "eod" falls back to the safer default rather than 400ing — an
  // unknown target is a client bug, and a member should still get the meaningful-everywhere cone.
  const target: ForecastTargetKind = req.nextUrl.searchParams.get("target") === "eod" ? "eod" : "expiry";

  const forecast = await getVectorPinForecast(ticker, target);
  return NextResponse.json(roundFloats({ ticker, target, forecast }, 2, VECTOR_FRACTION_DP), {
    headers: NO_STORE_HEADERS,
  });
}
