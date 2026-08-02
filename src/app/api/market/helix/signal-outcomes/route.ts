import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { dbConfigured, fetchRecentHelixSignalOutcomes } from "@/lib/db";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { MIN_GRADED_SAMPLE_FOR_WIN_RATE, summarizeHelixSignalOutcomes } from "@/features/helix/lib/helix-signal-outcome-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Helix Tier 2 item #10 — follow-through tracker. Read-only over the ledger
 *  helix-signal-outcomes-job.ts (Tier 2 item #9) writes; see that file and
 *  docs/audit/FINDINGS.md for the full root-cause writeup. */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!dbConfigured()) {
    return NextResponse.json(
      { rows: [], summary: null, error: "Signal outcome ledger unavailable" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const rows = await fetchRecentHelixSignalOutcomes(50);
    const summary = summarizeHelixSignalOutcomes(rows);
    return NextResponse.json(roundFloats({ rows, summary }), { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/helix/signal-outcomes]", error);
    return NextResponse.json(
      { rows: [], summary: null, error: "Signal outcome fetch failed" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}
