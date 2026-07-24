import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { buildGexLadder } from "@/features/vector/lib/vector-gex-ladder";
import { getHorizonStrikeTotals } from "@/features/vector/lib/vector-dte-walls-server";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-strike GEX ladder for the Vector strike-ladder side panel — the dense per-strike net-GEX
 * column a member scans next to the chart (Skylit-Atlas parity). Kept off the per-second SSE
 * payload (like the walls route) so the shared per-ticker stream fan-out stays lean; the panel
 * polls this on its own cadence.
 *
 * Data source is the SAME near-term aggregate that feeds the chart's default ("all") walls —
 * `GexHeatmap.gex.strike_totals` (strike → signed net GEX). `buildGexLadder` bands it around spot
 * and returns display-ready rows. Rounded at the data layer (repo policy — `strike_totals` are raw
 * provider floats). Horizon-scoping the ladder to the chart's DTE toggle is a documented follow-up.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: `Invalid ticker` }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const ticker = normalizeVectorTicker(rawTicker);
  const horizon = normalizeDteHorizon(req.nextUrl.searchParams.get("dte"));

  // Narrowed DTE (0DTE / weekly / monthly): scope the ladder to that horizon's expiries via the
  // same reconstruction ladder the DTE walls use, so the panel matches the chart's DTE toggle. On
  // "all" — or when the scoped fetch yields nothing (thin chain, off-hours) — fall back to the
  // near-term heatmap aggregate so the panel is never blanked by a narrow horizon.
  if (horizon !== "all") {
    const scoped = await getHorizonStrikeTotals(ticker, horizon).catch(() => null);
    if (scoped) {
      const ladder = buildGexLadder(scoped.strikeTotals, scoped.spot);
      // `asOf` was hardcoded null on this scoped path, so the panel had no freshness stamp
      // when a DTE horizon was selected. Thread the positioning snapshot's real ISO time
      // (getHorizonStrikeTotals → pos.asof) — the same heatmap-matrix timestamp class the
      // "all"/fallback branch below already surfaces via hm.asof. Never fabricated.
      return NextResponse.json(
        roundFloats({ ticker, spot: scoped.spot, asOf: scoped.asOf, horizon, ladder }),
        { headers: NO_STORE_HEADERS }
      );
    }
  }

  const hm = await fetchGexHeatmap(ticker).catch(() => null);
  const spot = hm?.spot ?? null;
  const ladder = buildGexLadder(hm?.gex?.strike_totals ?? null, spot);

  return NextResponse.json(
    roundFloats({ ticker, spot, asOf: hm?.asof ?? null, horizon, ladder }),
    { headers: NO_STORE_HEADERS }
  );
}
