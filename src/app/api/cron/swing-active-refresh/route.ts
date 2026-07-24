// Cron: hourly refresh of held SWING positions (PR-13, HOLD / evidence-only — first writer of snapshots).
//
// WHY: once positions persist, the desk needs each one's live path recorded on a heartbeat. Hourly, this route
// reads every OPEN swing position, gathers fresh underlying/mark reads, APPENDS a snapshot to the position's
// longitudinal series, and runs the PR-7 manager (via manage-sync) to latch live state. That snapshot series
// is the grader's (PR-8) and the trajectory studies' (PR-14) raw input.
//
// INVARIANTS: NEVER opens a position (no insertSwingPosition path) and NEVER writes a terminal status —
// closing/rolling is PR-15. Snapshots are APPEND-ONLY. FAIL-SOFT: a bad read or DB error on one position is
// isolated and tallied; it never aborts the loop or throws out of the cron (the loop core is in active-refresh).
//
// THIN HANDLER: the refresh loop (active-refresh.ts) and the management mapping (manage-sync.ts) are pure/
// injected and unit-tested; this handler only does auth, the live provider wiring, and the run/log.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { runSwingActiveRefresh } from "@/lib/swing/active-refresh";
import type { ManageSyncReads } from "@/lib/swing/manage-sync";
import { dteOf } from "@/lib/zerodte/scan-trigger";
import { fetchOpenSwingPositions, insertSwingSnapshot, updateSwingLiveState } from "@/lib/db";
import { fetchStockLastTrade } from "@/lib/providers/polygon-largo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Best-effort live underlying price from Polygon's last-trade (results.p). null when unavailable. */
async function loadUnderlyingSpot(ticker: string): Promise<number | null> {
  const trade = await fetchStockLastTrade(ticker);
  const p = trade && typeof trade === "object" ? Number((trade as Record<string, unknown>).p) : NaN;
  return Number.isFinite(p) && p > 0 ? p : null;
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowMs = started;
  try {
    const result = await runSwingActiveRefresh({
      fetchOpen: fetchOpenSwingPositions,
      // Per-position reads: fresh underlying spot + current DTE. Returning null skips the position for this
      // tick (no fabricated snapshot). Option mark is left null in v1 — the manager's premium rungs simply
      // skip (null-honesty); the underlying path + DTE are the load-bearing swing reads and are captured here.
      loadReads: async (row): Promise<ManageSyncReads | null> => {
        const spot = await loadUnderlyingSpot(row.ticker);
        if (spot == null) return null; // no usable read → skip (fail-soft, no snapshot)
        const dte = row.contract_expiry ? dteOf(row.contract_expiry, nowMs) : null;
        return {
          underlyingPrice: spot,
          dte,
          // MFE/MAE columns ratchet max/min underlying PRICE (GREATEST/LEAST) — feed the current spot as both
          // candidates; the ledger keeps the running extremes.
          underlyingMfe: spot,
          underlyingMae: spot,
        };
      },
      insertSnapshot: insertSwingSnapshot,
      updateLiveState: updateSwingLiveState,
      snapshotKind: "eod",
    });

    const payload = {
      ok: true,
      positions: result.positions,
      refreshed: result.refreshed,
      snapshotsAppended: result.snapshotsAppended,
      skippedCount: result.skipped,
      errored: result.errored,
    };
    await logCronRun("swing-active-refresh", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/swing-active-refresh]", error);
    await logCronRun("swing-active-refresh", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Swing active-refresh failed" }, { status: 500 });
  }
}
