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
import { isExpirySettled } from "@/lib/providers/expiry-liveness";
import type { BangerStatus } from "@/lib/banger/positions-db";

export type BangerLiveSyncRow = {
  id: number;
  session_date: string;
  ticker: string;
  contract_strike: number;
  contract_expiry: string;
  contract_occ: string;
  entry_premium: number;
  peak_premium: number | null;
  scaled_already: boolean;
  partial_realized_premium: number | null;
  last_mark?: number | null;
  status: BangerStatus;
};

export type BangerLiveSyncDeps = {
  fetchOpenPositions: () => Promise<BangerLiveSyncRow[]>;
  /** occ -> live mark. Missing/undefined mark means "skip this tick for this row" (fail-soft). */
  fetchMarks: (occs: string[]) => Promise<Map<string, number>>;
  /**
   * OCC-style settlement close for an ALREADY-EXPIRED contract's underlying, on its expiry date.
   *
   * WHY THIS EXISTS (found live 2026-09-23, Ask Largo standing mandate): once a contract's expiry
   * passes, the provider stops quoting it, so `fetchMarks` returns nothing for that row FOREVER —
   * the old code just `continue`d on every tick with no expiry-aware force-close anywhere, so a row
   * would sit in OPEN/PARTIAL indefinitely. Measured live: 41/168 (24%) of all open banger rows had
   * already-expired contracts, one 40 calendar days past expiry, none of them ever graded.
   *
   * Optional — omitting it (every pre-fix caller/test) reproduces the old behavior exactly: an
   * expired row is simply left untouched this tick (folds into `noQuote`). A null return (holiday,
   * no data yet) also leaves the row untouched rather than guessing at a settlement value.
   */
  fetchExpiryClose?: (ticker: string, expiryYmd: string) => Promise<number | null>;
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
  /** Rows force-closed this tick via `fetchExpiryClose` because their contract had already expired. */
  expiredSettled: number;
  transitions: Array<{ id: number; ticker: string; action: ScaleOutAction }>;
};

/**
 * Force-close a row whose contract has already expired and therefore never quotes again (see
 * `fetchExpiryClose`'s own doc comment on `BangerLiveSyncDeps`). Settles at OCC intrinsic value —
 * max(0, underlying close on expiry date - strike) — since every banger contract is a LONG call
 * (banger-lane-merge.ts hardcodes `right: "C"`, direction "LONG"). Reuses the EXACT partial+remainder
 * realized-P&L arithmetic the EXIT_RUNNER/STOP_OUT branch below already uses, with the settlement
 * value standing in for a live exit mark — never a bespoke formula for this path.
 *
 * Returns false (row left untouched this tick) when the close isn't available yet, rather than
 * fabricating a settlement value from stale or missing data.
 */
async function settleExpiredBangerRow(
  row: BangerLiveSyncRow,
  fetchExpiryClose: NonNullable<BangerLiveSyncDeps["fetchExpiryClose"]>,
  updateLiveState: BangerLiveSyncDeps["updateLiveState"],
): Promise<boolean> {
  const close = await fetchExpiryClose(row.ticker, row.contract_expiry);
  if (close == null || !Number.isFinite(close) || close < 0) return false;
  const intrinsic = Math.max(0, close - row.contract_strike);

  const alreadyScaled = row.scaled_already;
  const partial = alreadyScaled
    ? (row.partial_realized_premium ??
        SCALE_OUT_RULES.scale_fraction * row.entry_premium * SCALE_OUT_RULES.scale_at_mult)
    : 0;
  const remainingFraction = alreadyScaled ? 1 - SCALE_OUT_RULES.scale_fraction : 1;
  const realizedPremium = partial + remainingFraction * intrinsic;

  await updateLiveState(row.id, {
    status: "CLOSED_RUNNER",
    mark: intrinsic,
    scaleOutAction: "EXPIRED",
    scaleOutReason:
      `expired — settled at intrinsic value $${intrinsic.toFixed(2)} ` +
      `(underlying close $${close.toFixed(2)} vs strike $${row.contract_strike})`,
    realizedPnlPct: (realizedPremium / row.entry_premium - 1) * 100,
    realizedPnlUsd: (realizedPremium - row.entry_premium) * 100,
  });
  return true;
}

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
      expiredSettled: 0,
      transitions: [],
    };
  }

  const rows = await deps.fetchOpenPositions();
  if (rows.length === 0) {
    return {
      ok: true,
      skipped: false,
      positions: 0,
      refreshed: 0,
      noQuote: 0,
      expiredSettled: 0,
      transitions: [],
    };
  }

  const occs = [...new Set(rows.map((r) => r.contract_occ).filter(Boolean))];
  const marks = await deps.fetchMarks(occs);

  let refreshed = 0;
  let noQuote = 0;
  let expiredSettled = 0;
  const transitions: Array<{ id: number; ticker: string; action: ScaleOutAction }> = [];

  for (const row of rows) {
    const mark = marks.get(row.contract_occ);
    if (mark == null || !Number.isFinite(mark) || mark <= 0) {
      if (deps.fetchExpiryClose && isExpirySettled(row.contract_expiry)) {
        const settled = await settleExpiredBangerRow(row, deps.fetchExpiryClose, deps.updateLiveState);
        if (settled) {
          expiredSettled += 1;
          continue;
        }
      }
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
    if (newStatus !== row.status) {
      transitions.push({ id: row.id, ticker: row.ticker, action });
      void import("./discord-trade-notify")
        .then(({ notifyBangerFromScaleOutAction }) =>
          notifyBangerFromScaleOutAction(
            {
              session_date: row.session_date,
              position_id: row.id,
              ticker: row.ticker,
              contract_strike: row.contract_strike,
              contract_expiry: row.contract_expiry,
              entry_premium: row.entry_premium,
              last_mark: mark,
              scaled_already: row.scaled_already,
            },
            action,
            mark
          )
        )
        .catch((err) => {
          console.warn(`[banger-discord] scale-out notify failed for ${row.ticker} (${action}):`, err);
        });
    }
  }

  return { ok: true, skipped: false, positions: rows.length, refreshed, noQuote, expiredSettled, transitions };
}
