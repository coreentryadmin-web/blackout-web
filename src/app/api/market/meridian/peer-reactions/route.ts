import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { loadMeridianPeerReactions } from "@/lib/meridian/meridian-peer-reactions";
import { MAX_PEER_REACTION_TICKERS } from "@/lib/meridian/meridian-sector-core";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("meridian");
  if (locked) return locked;

  const raw = req.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    // Enforced here, not just in the loader's doc comment — a caller passing more than the cap
    // gets exactly `MAX_PEER_REACTION_TICKERS` answers and no error, matching how the Sector
    // Peers panel itself already truncates ("+N more in cohort") rather than rejecting a request.
    .slice(0, MAX_PEER_REACTION_TICKERS);

  if (tickers.length === 0) {
    return NextResponse.json({ error: "tickers required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const reactions = await loadMeridianPeerReactions(tickers);
    return NextResponse.json({ reactions }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/meridian/peer-reactions]", error);
    return NextResponse.json({ error: "Peer reaction lookup failed" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
