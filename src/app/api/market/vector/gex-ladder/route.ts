import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { buildGexLadder } from "@/features/vector/lib/vector-gex-ladder";
import { getHorizonStrikeTotals } from "@/features/vector/lib/vector-dte-walls-server";
import { resolveDteHorizonParam } from "@/features/vector/lib/vector-dte-horizon";
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
 * Data source for the default ("all") horizon is `GexHeatmap.gex.strike_totals` (strike → signed
 * net GEX), the SAME near-term aggregate that feeds the chart's default walls. `buildGexLadder`
 * bands it around spot and returns display-ready rows. Rounded at the data layer (repo policy —
 * `strike_totals` are raw provider floats).
 *
 * A narrowed DTE horizon (0DTE/weekly/monthly) is scoped via `getHorizonStrikeTotals`, which
 * re-derives the ladder from the same per-expiry chain reconstruction the chart's DTE walls use —
 * see the fallback branch below for the "all"/thin-chain degrade.
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

  // Narrowed DTE (0DTE / weekly / monthly): scope the ladder to that horizon's expiries via the
  // same reconstruction ladder the DTE walls use, so the panel matches the chart's DTE toggle. On
  // "all" — or when the scoped fetch yields nothing (thin chain, off-hours) — fall back to the
  // near-term heatmap aggregate so the panel is never blanked by a narrow horizon.
  // Fetched up front because BOTH branches need it now: the "all" branch for the ladder itself,
  // the narrowed branch for the forced-flow rail only. It is an in-memory cached read on the same
  // matrix the page is already showing, so hoisting it costs a map lookup, not a round trip.
  const hm = await fetchGexHeatmap(ticker).catch(() => null);

  // The forced-flow rail is served on EVERY horizon, and is deliberately NOT re-scoped to the
  // narrowed one.
  //
  // It was originally restricted to "all" so the rail could never sit beside bars drawn from a
  // different expiry set. Live check on prod proved that reasoning shipped the feature DARK: the
  // Vector chart defaults to "weekly", and to "0dte" on oracle tickers like SPY, so the default
  // view of the page a member lands on never rendered a single rail cell. A correctness guard that
  // hides the feature in its own default state is not a guard, it is a bug.
  //
  // Serving the near-term book on every horizon is also the more defensible number. Forced hedging
  // flow is a property of the WHOLE near-term book — dealers hedge the position they hold, not the
  // expiry subset a member happens to be looking at — so narrowing it to 0DTE would understate the
  // flow rather than scope it correctly. The scope is stated in the panel legend instead of being
  // silently implied, which is the same rule the ladder's "conditional flow, not resting liquidity"
  // note follows.
  const depth = hm?.depth ?? null;

  if (horizon !== "all") {
    const scoped = await getHorizonStrikeTotals(ticker, horizon).catch(() => null);
    if (scoped) {
      const ladder = buildGexLadder(scoped.strikeTotals, scoped.spot);
      // `asOf` was hardcoded null on this scoped path, so the panel had no freshness stamp
      // when a DTE horizon was selected. Thread the positioning snapshot's real ISO time
      // (getHorizonStrikeTotals → pos.asof) — the same heatmap-matrix timestamp class the
      // "all"/fallback branch below already surfaces via hm.asof. Never fabricated.
      return NextResponse.json(
        // `depth.spot` is the matrix's spot, which is what the rail must be mapped against —
        // NOT `scoped.spot`. The two come from different snapshots and can differ by a tick, and
        // the band geometry is defined relative to the spot the ladder was built at.
        roundFloats({ ticker, spot: scoped.spot, asOf: scoped.asOf, horizon, ladder, depth, depthSpot: hm?.spot ?? null }),
        { headers: NO_STORE_HEADERS }
      );
    }
  }

  const spot = hm?.spot ?? null;
  // Wall-migration arrows (2026-08-06): the "all" horizon reads the SAME heatmap payload the
  // shift-leaders strip above the pulse rail already reads, so threading its `shift.delta_by_strike`
  // through is free — no new fetch. Only wired when the shift computation actually has a baseline
  // (`available`); the narrowed-horizon branch above never has one (see buildGexLadder's opts doc).
  const shiftByStrike = hm?.shift?.available ? hm.shift.delta_by_strike : null;
  const ladder = buildGexLadder(hm?.gex?.strike_totals ?? null, spot, { shiftByStrike });

  return NextResponse.json(
    roundFloats({ ticker, spot, asOf: hm?.asof ?? null, horizon, ladder, depth, depthSpot: hm?.spot ?? null }),
    { headers: NO_STORE_HEADERS }
  );
}
