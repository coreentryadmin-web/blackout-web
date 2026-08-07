import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { getVectorExpectedMove } from "@/features/vector/lib/vector-expected-move-server";
import { resolveDteHorizonParam } from "@/features/vector/lib/vector-dte-horizon";
import { roundFloats } from "@/lib/round-floats";
import { VECTOR_FRACTION_DP } from "@/features/vector/lib/vector-response-rounding";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Options-implied expected move (±1σ/±2σ bands) scoped to a DTE horizon — the read behind the Vector
 * chart's expected-move cone (task #15). Kept OFF the per-second SSE payload (like the walls / ladder
 * / max-pain reads) so the shared per-ticker stream stays lean; the client fetches it once per
 * ticker/DTE toggle and draws the band.
 *
 * Same gate as the sibling reads (authorizePremiumDeskApi + requireToolApi("vector") + ticker
 * allowlist). `expectedMove: null` when there's no honest band to draw (no chain / horizon / real
 * ATM IV) — the client omits the cone. Floats rounded at the data layer per repo policy, with a
 * per-key precision override for the two FRACTIONAL fields (`movePct`, `atmIv`) — see
 * {@link VECTOR_FRACTION_DP}. The blanket 2dp default quantized SPX's `movePct` (0.004) to a literal
 * 0, so the route served "±31 pts (0.00%)".
 */
export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: `Invalid ticker` }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const ticker = normalizeVectorTicker(rawTicker);
  const horizon = resolveDteHorizonParam(req.nextUrl.searchParams);

  const em = await getVectorExpectedMove(ticker, horizon);
  return NextResponse.json(
    roundFloats({
      ticker,
      horizon,
      expectedMove: em, // { atmIv, dteDays, spot, movePct, bands:[{sigma,low,high,movePts}], expiry } | null
    }, 2, VECTOR_FRACTION_DP),
    { headers: NO_STORE_HEADERS }
  );
}
