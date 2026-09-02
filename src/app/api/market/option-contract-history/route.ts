import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { buildOccContractId, contractLabel } from "@/lib/helix/occ-contract-id";
import { groupFlowHistoryByDay } from "@/lib/helix/contract-history";
import { HELIX_FLOW_MAX_SINCE_HOURS } from "@/features/helix/lib/helix-flow-limits";
import { serverCache, TTL } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
// nodejs runtime is required: fetchRecentFlows (pg Pool) pulls node-only modules the edge
// runtime rejects — same requirement as /api/market/flows/route.ts.
export const runtime = "nodejs";

/**
 * Multi-day per-contract flow history — ContractDrilldownDrawer.tsx's "today only" view
 * (option-contract/route.ts, UW's live contract-flow API) has no persisted multi-day
 * equivalent. This queries flow_alerts (our own persisted ingest, not UW's live endpoint) for
 * ONE exact contract over HELIX_FLOW_MAX_SINCE_HOURS (30 days — the same bound /api/market/flows
 * already enforces as HELIX's app-wide "how far back are we allowed to look" policy; this reuses
 * that constant rather than inventing a second lookback number for the same product).
 *
 * authorizePremiumDeskApi, not the weaker authorizeMarketDeskApi option-contract/route.ts uses —
 * this reads flow_alerts, the same premium-gated data /api/market/flows serves, not a UW
 * passthrough.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") ?? "").toUpperCase();
  const expiry = sp.get("expiry") ?? "";
  const strike = Number(sp.get("strike"));
  const optionTypeRaw = (sp.get("option_type") ?? "").toUpperCase();
  const optionType = optionTypeRaw === "PUT" ? "PUT" : optionTypeRaw === "CALL" ? "CALL" : null;

  if (!ticker || !expiry || !optionType || !Number.isFinite(strike) || strike <= 0) {
    return NextResponse.json({ error: "ticker, expiry, strike, option_type required" }, { status: 400 });
  }

  const contractId = buildOccContractId(ticker, expiry, optionType, strike);
  if (!contractId) {
    return NextResponse.json({ error: "Invalid contract parameters" }, { status: 400 });
  }

  const cacheKey = `helix:contract-history:${contractId}`;
  try {
    const payload = await serverCache(cacheKey, TTL.DARK_POOL, async () => {
      const rows = await fetchRecentFlows({
        ticker,
        strike,
        expiry: expiry.slice(0, 10),
        option_type: optionType,
        since_hours: HELIX_FLOW_MAX_SINCE_HOURS,
        order: "recent",
        limit: 2000, // one contract's prints over 30 days — well under the tape's 5000 cap
      });

      const days = groupFlowHistoryByDay(rows);
      return {
        contract_id: contractId,
        label: contractLabel(ticker, strike, optionType, expiry),
        ticker,
        strike,
        expiry: expiry.slice(0, 10),
        option_type: optionType,
        lookback_days: Math.round(HELIX_FLOW_MAX_SINCE_HOURS / 24),
        days,
        total_prints: rows.length,
      };
    });

    return NextResponse.json(roundFloats(payload), { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("[market/option-contract-history]", contractId, err);
    return NextResponse.json({ error: "Contract history unavailable" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
