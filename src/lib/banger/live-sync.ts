/**
 * ENGINE B — live-sync orchestrator.
 * ============================================================================
 * For each OPEN/PARTIAL banger_positions row: fetch the current option mark, run it through the SHARED
 * production scale-out state machine (src/lib/zerodte/scale-out.ts deriveScaleOutAction — the exact same
 * rule the research backtest grades under), and apply the resulting transition via updateBangerLiveState.
 * Checks the kill-switch FIRST — a disabled engine leaves every open position exactly as it was (marks
 * simply stop refreshing; nothing is force-closed).
 *
 * Realized bookkeeping: TAKE_PARTIAL freezes `partial_realized_premium` = scale_fraction * entry *
 * scale_at_mult (first-write-wins in the DB CASE); a terminal transition (CLOSED_RUNNER/STOPPED) freezes
 * realized_pnl_pct/usd from the SAME arithmetic gradeScaleOut uses (partial tranche + remaining-at-exit),
 * so the live ledger and the offline grader can never silently diverge on what "realized" means.
 */

import { deriveScaleOutAction, SCALE_OUT_RULES, type ScaleOutAction } from "@/lib/zerodte/scale-out";
import { isBangerEngineEnabled } from "@/lib/banger/flag";
import type { BangerStatus } from "@/lib/banger/positions-db";

export type BangerLiveSyncRow = {
  id: number;
  ticker: string;
  contract_occ: string;
  entry_premium: number;
  peak_premium: number | null;
  scaled_already: boolean;
  partial_realized_premium: number | null;
  status: BangerStatus;
};

export type BangerLiveSyncDeps = {
  fetchOpenPositions: () => Promise<BangerLiveSyncRow[]>;
  /** occ -> live mark. Missing/undefined mark means "skip this tick for this row" (fail-soft). */
  fetchMarks: (occs: string[]) => Promise<Map<string, number>>;
  updateLiveState: (
    id: number,
    update: {
      status: BangerStatus;
      mark?: number | null;
      scaleOutAction?: string | null;
      scaleOutReason?: string | null;
      scaledNow?: boolean;
      partialRealizedPremium?: number | null;
      realizedPnlPct?: number | null;
      realizedPnlUsd?: number | null;
    },
  ) => Promise<void>;
  env?: NodeJS.ProcessEnv;
};

export type BangerLiveSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  positions: number;
  refreshed: number;
  noQuote: number;
  transitions: Array<{ id: number; ticker: string; action: ScaleOutAction }>;
};

/** Maps a scale-out action to the resulting DB status. HOLD keeps the row's current status. */
function statusForAction(action: ScaleOutAction, current: BangerStatus): BangerStatus {
  if (action === "TAKE_PARTIAL") return "PARTIAL";
  if (action === "EXIT_RUNNER") return "CLOSED_RUNNER";
  if (action === "STOP_OUT") return "STOPPED";
  return current;
}

export async function runBangerLiveSync(deps: BangerLiveSyncDeps): Promise<BangerLiveSyncResult> {
  const env = deps.env ?? process.env;
  if (!isBangerEngineEnabled(env)) {
    return {
      ok: true,
      skipped: true,
      reason: "BANGER_ENGINE_ENABLED=0 — Engine B is off",
      positions: 0,
      refreshed: 0,
      noQuote: 0,
      transitions: [],
    };
  }

  const rows = await deps.fetchOpenPositions();
  if (rows.length === 0) {
    return { ok: true, skipped: false, positions: 0, refreshed: 0, noQuote: 0, transitions: [] };
  }

  const occs = [...new Set(rows.map((r) => r.contract_occ).filter(Boolean))];
  const marks = await deps.fetchMarks(occs);

  let refreshed = 0;
  let noQuote = 0;
  const transitions: Array<{ id: number; ticker: string; action: ScaleOutAction }> = [];

  for (const row of rows) {
    const mark = marks.get(row.contract_occ);
    if (mark == null || !Number.isFinite(mark) || mark <= 0) {
      noQuote += 1;
      continue;
    }
    refreshed += 1;
    const peak = row.peak_premium ?? row.entry_premium;
    const { action, reason } = deriveScaleOutAction({
      entryPremium: row.entry_premium,
      peakPremium: Math.max(peak, mark),
      lastMark: mark,
      scaledAlready: row.scaled_already,
    });

    const newStatus = statusForAction(action, row.status);
    const update: Parameters<BangerLiveSyncDeps["updateLiveState"]>[1] = {
      status: newStatus,
      mark,
      scaleOutAction: action,
      scaleOutReason: reason,
    };

    if (action === "TAKE_PARTIAL") {
      update.scaledNow = true;
      update.partialRealizedPremium =
        SCALE_OUT_RULES.scale_fraction * row.entry_premium * SCALE_OUT_RULES.scale_at_mult;
    } else if (action === "EXIT_RUNNER" || action === "STOP_OUT") {
      // Terminal realized P&L: the partial tranche already banked (0 if never scaled) plus the
      // remaining fraction realized at THIS exit — the same two-part sum gradeScaleOut accumulates.
      const alreadyScaled = row.scaled_already;
      const partial = alreadyScaled
        ? (row.partial_realized_premium ??
            SCALE_OUT_RULES.scale_fraction * row.entry_premium * SCALE_OUT_RULES.scale_at_mult)
        : 0;
      const remainingFraction = alreadyScaled ? 1 - SCALE_OUT_RULES.scale_fraction : 1;
      const exitPremium = action === "STOP_OUT" ? row.entry_premium * SCALE_OUT_RULES.hard_stop_mult : mark;
      const realizedPremium = partial + remainingFraction * exitPremium;
      update.realizedPnlPct = (realizedPremium / row.entry_premium - 1) * 100;
      update.realizedPnlUsd = (realizedPremium - row.entry_premium) * 100; // per 1 contract (100x multiplier)
    }

    await deps.updateLiveState(row.id, update);
    if (newStatus !== row.status) transitions.push({ id: row.id, ticker: row.ticker, action });
  }

  return { ok: true, skipped: false, positions: rows.length, refreshed, noQuote, transitions };
}
