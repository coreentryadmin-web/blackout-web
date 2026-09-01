import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { fetchOptionsUnifiedSnapshot, type OptionSnapshot } from "@/lib/providers/options-snapshot";
import { getLiveOptionMarkSync } from "@/lib/ws/options-socket";
import { ZERODTE_MARK_STALE_MS } from "@/lib/zerodte/marks-math";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LegacyOptionMarkRow = {
  occ: string;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  asof: string | null;
  stale: boolean;
};

/** Live option marks for Legacy edition contracts — WS-first, REST snapshot fallback.
 *  Query: ?occs=NVDA260822C00500000,AMD260815C00120000 (max 12). */
export async function GET(req: NextRequest) {
  const auth = await authorizeCronOrTierApi(req, "premium");
  if (auth instanceof Response) return auth;
  if (auth.via === "user") {
    const denied = await requireToolApi("nighthawk");
    if (denied) return denied;
  }

  const raw = req.nextUrl.searchParams.get("occs") ?? "";
  const occs = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 12);
  if (!occs.length) {
    return NextResponse.json({ available: false, marks: [] }, { headers: NO_STORE_HEADERS });
  }

  ensureDataSockets();

  let snaps = new Map<string, OptionSnapshot>();
  try {
    snaps = await fetchOptionsUnifiedSnapshot(occs);
  } catch {
    snaps = new Map();
  }

  const now = Date.now();
  const marks: LegacyOptionMarkRow[] = occs.map((occ) => {
    const ws = getLiveOptionMarkSync(occ, ZERODTE_MARK_STALE_MS);
    const snap = snaps.get(occ);
    const bid = ws?.bid ?? snap?.bid ?? null;
    const ask = ws?.ask ?? snap?.ask ?? null;
    const mark = ws?.mark ?? snap?.mark ?? (bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask ?? null);
    const asof =
      ws != null ? new Date(ws.ts).toISOString() : null;
    const asofMs = asof ? Date.parse(asof) : NaN;
    const stale = !Number.isFinite(asofMs) || now - asofMs > ZERODTE_MARK_STALE_MS;
    return { occ, mark, bid, ask, asof, stale };
  });

  return NextResponse.json({ available: true, marks }, { headers: NO_STORE_HEADERS });
}
