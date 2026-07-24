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
import {
  fetchOpenSwingPositions,
  insertSwingSnapshot,
  updateSwingLiveState,
  insertSwingPosition,
  gradeSwingPosition,
  withSwingRollTx,
  type SwingPositionRow,
} from "@/lib/db";
import { fetchStockLastTrade } from "@/lib/providers/polygon-largo";
import { fetchOptionsUnifiedSnapshot } from "@/lib/providers/options-snapshot";
import { todayEt } from "@/lib/et-date";
import { buildSwingRollPlan } from "@/lib/swing/roll-plan";
import { modelRiskUsd, isEventArchetype, type CommitBookPosition } from "@/lib/swing/commit";
import { resolveProductionPortfolioBudget } from "@/lib/swing/swing-portfolio-budget";
import type { ParentGradeFreeze } from "@/lib/swing/roll";
import type { SwingArchetype } from "@/lib/swing/taxonomy";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Best-effort live underlying price from Polygon's last-trade (results.p). null when unavailable. */
async function loadUnderlyingSpot(ticker: string): Promise<number | null> {
  const trade = await fetchStockLastTrade(ticker);
  const p = trade && typeof trade === "object" ? Number((trade as Record<string, unknown>).p) : NaN;
  return Number.isFinite(p) && p > 0 ? p : null;
}

/**
 * Best-effort live OPTION mark for a held position's contract (reuses the 0DTE unified-snapshot marks path).
 * The ledger stores the OCC without the `O:` prefix the snapshot endpoint expects, so normalize it first.
 * Returns null (contract unknown / no quote / fetch error) → the manager's premium rungs skip via null-honesty
 * rather than acting on a fabricated mark. `.mark` is the doc-priority mark (mid → last → day close).
 */
async function loadOptionMark(row: SwingPositionRow): Promise<number | null> {
  const raw = row.contract_occ?.trim();
  if (!raw) return null;
  const occ = raw.startsWith("O:") ? raw : `O:${raw}`;
  try {
    const snaps = await fetchOptionsUnifiedSnapshot([occ]);
    const mark = snaps.get(occ)?.mark;
    return typeof mark === "number" && Number.isFinite(mark) && mark > 0 ? mark : null;
  } catch {
    return null; // best-effort: a marks miss must never sink the refresh (underlying path still records)
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowMs = started;
  try {
    // Fetch the open book ONCE — reused as the refresh working set AND as the roll gate's book snapshot (budget
    // + caps + idempotency). A roll is near risk-neutral, so a snapshot that doesn't reflect an intra-pass child
    // is conservative, not unsafe.
    const openRows = await fetchOpenSwingPositions().catch(() => []);
    const rollBook: CommitBookPosition[] = openRows.map((r) => {
      const pinned = r.entry_context?.risk_usd;
      const riskUsd = typeof pinned === "number" && Number.isFinite(pinned) ? pinned : modelRiskUsd(r.entry_premium);
      return {
        ticker: r.ticker,
        direction: r.direction === "short" ? "SHORT" : "LONG",
        commitKey: r.commit_key,
        riskUsd,
        isEvent: isEventArchetype(r.archetype as SwingArchetype | null),
        isOvernight: true,
        expiry: r.contract_expiry,
      };
    });
    const budget = resolveProductionPortfolioBudget();
    const sessionDay = todayEt(new Date(nowMs));
    // The roll child needs a fresh chain — the SAME resolver discovery uses; fail-soft (→ []) per name.
    const fetchChainRows = async (ticker: string) => {
      try {
        return (await resolveTickerChainRows(ticker))?.rows ?? [];
      } catch (err) {
        console.error(`[cron/swing-active-refresh] chain fetch failed for ${ticker} — roll can't build a child`, err);
        return [];
      }
    };

    const result = await runSwingActiveRefresh({
      // Reuse the once-fetched open book as the working set (also the roll gate's book snapshot above).
      fetchOpen: async () => openRows,
      // Per-position reads: fresh underlying spot + current DTE + the held contract's live OPTION mark.
      // Returning null skips the position for this tick (no fabricated snapshot). The underlying spot is
      // load-bearing (null → skip); the option mark is best-effort (null → the manager's premium rungs skip
      // via null-honesty, but the underlying path + snapshot still record). The live mark ALSO lets the roll
      // executor freeze the parent grade at roll time (roll-plan.ts gradeParentFromMark).
      loadReads: async (row): Promise<ManageSyncReads | null> => {
        const [spot, mark] = await Promise.all([loadUnderlyingSpot(row.ticker), loadOptionMark(row)]);
        if (spot == null) return null; // no usable underlying read → skip (fail-soft, no snapshot)
        const dte = row.contract_expiry ? dteOf(row.contract_expiry, nowMs) : null;
        return {
          underlyingPrice: spot,
          // Live contract mark → drives the premium ratchet (peak/trough) + the profit-ladder / −60% backstop
          // premium rungs, and lands on the snapshot's option_mark + feature-vector option_return_pct.
          mark,
          dte,
          // PRICE candidates for the ledger's underlying_mfe/underlying_mae high/low-water columns (ratcheted
          // via GREATEST/LEAST). The snapshot's running_mfe/running_mae is the SIGNED excursion % that
          // planManageSync derives from these ratcheted extremes + entry — NOT this raw spot.
          underlyingMfe: spot,
          underlyingMae: spot,
        };
      },
      insertSnapshot: insertSwingSnapshot,
      updateLiveState: updateSwingLiveState,
      snapshotKind: "eod",
      // ── LIVE ROLL SEAM (go-live 2026-07-24) — the roll executor acts ONLY on a capital-preservation GATE rung
      //    and ONLY when it can freeze the parent (from a live/latched mark) AND gate the child (budget + caps +
      //    idempotency). Absent any of those → manage-sync stays evidence-only (no terminal write). The three
      //    roll-ledger accessors + runRollTx make the close+grade+child write ATOMIC (BEGIN/COMMIT, rollback on
      //    a 0-row grade race — db.ts withSwingRollTx). ──
      insertChild: insertSwingPosition,
      gradeParent: async (id: number, g: ParentGradeFreeze & { status: "CLOSED" | "ROLLED" }) => {
        await gradeSwingPosition(id, g);
      },
      runRollTx: withSwingRollTx,
      buildRollPlan: (row, verdict, reads) =>
        buildSwingRollPlan(row, verdict, reads, { fetchChainRows, book: rollBook, budget, sessionDay }),
    });

    // Tally the LIVE roll outcomes for observability (a roll writes a terminal parent status + opens a child).
    const rolls = result.outcomes.filter((o) => o.roll);
    const payload = {
      ok: true,
      positions: result.positions,
      refreshed: result.refreshed,
      snapshotsAppended: result.snapshotsAppended,
      skippedCount: result.skipped,
      errored: result.errored,
      rolled: rolls.filter((o) => o.roll?.action === "ROLL" && o.roll?.childId != null).length,
      closed: rolls.filter((o) => o.roll?.action === "CLOSE" && o.roll?.parentGraded).length,
      rollErrors: rolls.filter((o) => o.roll?.error).length,
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
