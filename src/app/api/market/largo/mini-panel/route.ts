import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { fetchMiniPanelPayload } from "@/lib/largo/mini-panel";

export const dynamic = "force-dynamic";

/** Live mini-panel beside Largo answers — same cache readers as desk UIs. */
export async function GET(req: Request) {
  const auth = await requireTierApi("premium");
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const desk = String(url.searchParams.get("desk") ?? "").trim();
  const ticker = String(url.searchParams.get("ticker") ?? "").trim() || undefined;
  const submodule = String(url.searchParams.get("submodule") ?? "").trim() || undefined;

  if (!desk) {
    return NextResponse.json({ error: "desk is required" }, { status: 400 });
  }

  const panel = await fetchMiniPanelPayload({ desk, ticker, submodule });
  if (!panel) {
    return NextResponse.json({ error: "unknown desk" }, { status: 404 });
  }

  return NextResponse.json(panel, { headers: NO_STORE_HEADERS });
}
