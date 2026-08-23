import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { dbConfigured, fetchLatestCronJobRun, fetchRecentHelixSignalOutcomes } from "@/lib/db";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { summarizeHelixSignalOutcomes } from "@/features/helix/lib/helix-signal-outcome-summary";
import {
  SIGNAL_LEDGER_WRITER_JOB_KEY,
  signalLedgerStatus,
} from "@/features/helix/lib/helix-signal-ledger-status";

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
      { rows: [], summary: null, ledger: null, error: "Signal outcome ledger unavailable" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const rows = await fetchRecentHelixSignalOutcomes(50);
    const summary = summarizeHelixSignalOutcomes(rows);

    // An empty ledger and an UNWRITTEN ledger are opposite facts that look identical from a row
    // count, and the panel asserted the first while the second was true. Only pay for the extra
    // query when there is nothing to show — with rows present the distinction is moot.
    let lastWriterRunAt: string | null = null;
    if (rows.length === 0) {
      try {
        lastWriterRunAt = (await fetchLatestCronJobRun(SIGNAL_LEDGER_WRITER_JOB_KEY))?.started_at ?? null;
      } catch (probeError) {
        // A failed probe must NOT become evidence that the writer is missing — that would turn a
        // query error into a confident "not recording" verdict, which is the same absence-as-fact
        // mistake this whole field exists to remove. It must also not fail a read that already
        // succeeded. So: `ledger: null` = "could not determine", a third thing, and the panel
        // renders neutral copy for it rather than either verdict.
        console.warn("[market/helix/signal-outcomes] writer probe failed:", probeError);
        return NextResponse.json(roundFloats({ rows, summary, ledger: null }), {
          headers: NO_STORE_HEADERS,
        });
      }
    }
    const ledger = signalLedgerStatus({ rowCount: rows.length, lastWriterRunAt });

    return NextResponse.json(roundFloats({ rows, summary, ledger }), { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/helix/signal-outcomes]", error);
    return NextResponse.json(
      { rows: [], summary: null, ledger: null, error: "Signal outcome fetch failed" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}
