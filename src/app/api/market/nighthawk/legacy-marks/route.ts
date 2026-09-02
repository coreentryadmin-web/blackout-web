import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { fetchOptionsUnifiedSnapshot, type OptionSnapshot } from "@/lib/providers/options-snapshot";
import { getLiveOptionMarkSync } from "@/lib/ws/options-socket";
import { ZERODTE_MARK_STALE_MS } from "@/lib/zerodte/marks-math";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import {
  buildLegacyOptionMarkRow,
  type LegacyOptionMarkRow,
} from "@/features/nighthawk/lib/legacy-option-mark-row";
import {
  legacyOccForSnapshot,
  lookupLegacyOptionSnapshot,
} from "@/features/nighthawk/lib/legacy-play-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { LegacyOptionMarkRow };

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
    snaps = await fetchOptionsUnifiedSnapshot(occs.map(legacyOccForSnapshot));
  } catch {
    snaps = new Map();
  }

  const now = Date.now();
  const marks: LegacyOptionMarkRow[] = occs.map((occ) => {
    const ws = getLiveOptionMarkSync(occ, ZERODTE_MARK_STALE_MS)
      ?? getLiveOptionMarkSync(legacyOccForSnapshot(occ), ZERODTE_MARK_STALE_MS);
    const snap = lookupLegacyOptionSnapshot(snaps, occ);
    return buildLegacyOptionMarkRow(occ, ws, snap, now);
  });

  return NextResponse.json({ available: true, marks }, { headers: NO_STORE_HEADERS });
}
