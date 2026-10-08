import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { requireDatabaseInProduction } from "@/lib/db";
import { requireToolApi } from "@/lib/tool-access-server";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { roundFloats } from "@/lib/round-floats";
import { loadSwingPlayBriefContext } from "@/lib/swing/play-brief-context";
import { composeSwingPlayBrief } from "@/lib/swing/play-brief";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/market/swing/play-brief?playId=SWING:NRG&ticker=NRG
 *
 * Deterministic Swing Play Intelligence brief — no Anthropic. Same BieAnswerEnvelope
 * shape Largo renders; refreshes cheaply on a timer beside the command deck.
 */
export async function GET(req: NextRequest) {
  const auth = await requireTierApi("premium");
  if (auth instanceof Response) return auth;

  const toolDenied = await requireToolApi("nighthawk");
  if (toolDenied) return toolDenied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const playId = (req.nextUrl.searchParams.get("playId") ?? "").trim();
  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "").trim();
  const status = (req.nextUrl.searchParams.get("status") ?? "").trim() || null;
  const right = (req.nextUrl.searchParams.get("right") ?? "").trim() || null;
  const strikeRaw = req.nextUrl.searchParams.get("strike");
  const strike = strikeRaw != null && strikeRaw !== "" ? Number(strikeRaw) : null;
  const positionIdRaw = req.nextUrl.searchParams.get("positionId");
  const positionId =
    positionIdRaw != null && positionIdRaw !== "" ? Number(positionIdRaw) : null;
  const expandIntel = req.nextUrl.searchParams.get("expandIntel") === "1";
  if (!playId) {
    return NextResponse.json({ error: "playId is required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const ctx = await loadSwingPlayBriefContext({
      playId,
      ticker,
      positionId: positionId != null && Number.isFinite(positionId) ? positionId : null,
      status,
      strike: strike != null && Number.isFinite(strike) ? strike : null,
      right,
    });
    if (!ctx) {
      return NextResponse.json({ available: false, error: "play not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const brief = composeSwingPlayBrief(ctx, { expandIntel });
    // `distancePct` (structureLadder rungs/risk) is narrated everywhere at 1dp (`fmtPct`'s
    // default) — round it to 1dp here too, not the generic 2dp default, so the wire number
    // the client re-rounds is already at the SAME precision the narrative committed to. Without
    // this override, a client-side re-round of an already-2dp value is a genuine DOUBLE round
    // that can disagree with the narrative's own single round of the raw float at a half-unit
    // boundary (see `fmtPct`'s header in fmt-money.ts for the live repro and the fix).
    return NextResponse.json(roundFloats({ available: true, ...brief }, 2, { distancePct: 1 }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[market/swing/play-brief]", error);
    return NextResponse.json({ available: false, degraded: true }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
