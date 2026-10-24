import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { fetchOptionsUnifiedSnapshot, type OptionSnapshot } from "@/lib/providers/options-snapshot";
import { getLiveOptionMarkSync } from "@/lib/ws/options-socket";
import { LEGACY_QUOTE_STALE_MS } from "@/lib/zerodte/marks-math";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { roundFloats } from "@/lib/round-floats";
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
  // BUG (found 2026-09-16, live audit — sibling of the legacy-option-mark-row.ts fix earlier
  // today): this WS-freshness gate used ZERODTE_MARK_STALE_MS (5s) to decide whether a cached
  // WS tick counts as "live" at all — a tick 5-30s old was silently discarded here and the row
  // fell through to the REST snapshot instead, even when the REST snapshot's own quote clock
  // was EQUALLY OR MORE stale than the WS tick that got thrown away. Reproduced live: CRWD (a
  // normal liquid name) read `stale:true` repeatedly with asof lagging real time by 70-90s,
  // because a genuinely <30s-old WS tick kept getting rejected by this 5s gate before
  // buildLegacyOptionMarkRow's own (already-correct, LEGACY_QUOTE_STALE_MS) staleness check
  // ever saw it. This route is Legacy-only (no horizon branching needed, same as
  // legacy-option-mark-row.ts) — gate on LEGACY_QUOTE_STALE_MS so a WS tick up to 30s old is
  // still treated as live, consistent with the staleness bar the row itself is graded against.
  const marks: LegacyOptionMarkRow[] = occs.map((occ) => {
    const ws = getLiveOptionMarkSync(occ, LEGACY_QUOTE_STALE_MS)
      ?? getLiveOptionMarkSync(legacyOccForSnapshot(occ), LEGACY_QUOTE_STALE_MS);
    const snap = lookupLegacyOptionSnapshot(snaps, occ);
    return buildLegacyOptionMarkRow(occ, ws, snap, now);
  });

  return NextResponse.json(roundFloats({ available: true, marks }), { headers: NO_STORE_HEADERS });
}
