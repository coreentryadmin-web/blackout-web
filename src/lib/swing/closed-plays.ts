// src/lib/swing/closed-plays.ts — map graded CLOSED ledger rows onto deck payloads (CLOSED tab parity).
//
// The horizons lane serves pre-entry + live open book; this mapper covers the third bucket members
// expect from 0DTE parity: finished swing positions with realized P&L. PURE — callers supply DB rows.

import type { SwingPositionRow } from "../db";
import { calendarDte } from "../horizon-fanout";
import { HORIZONS } from "../horizons";

const fin = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

function etYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Wire shape for terminalPlayFromHorizon — kept in lib/ to avoid features import. */
export type SwingClosedDeckSource = {
  positionId: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  horizon: "SWING";
  score: number;
  status: "CLOSED";
  reason: string;
  contract: {
    strike: number;
    right: "C" | "P";
    expiry: string;
    dte: number;
    mid?: number | null;
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
    iv?: number | null;
  };
  archetype?: string | null;
  subLane?: string | null;
  firstSeenAt?: string | null;
  committedAt?: string | null;
  entryPremium?: number | null;
  peakPremium?: number | null;
  troughPremium?: number | null;
  occ?: string | null;
  exitAt?: string | null;
  exitPnlPct?: number | null;
  closedReason?: string | null;
};

function closedReasonFromRow(row: SwingPositionRow): string | null {
  const pnl = fin(row.realized_pnl_pct);
  if (pnl == null) return null;
  if (pnl > 0) return "target";
  if (pnl < 0) return "stopped";
  return "flat";
}

/** Map one graded CLOSED ledger row to a deck source. Null when not reconstructible. */
export function closedDeckSourceFromRow(row: SwingPositionRow): SwingClosedDeckSource | null {
  if (row.status !== "CLOSED" || !row.graded_at) return null;
  const expiry = row.contract_expiry;
  const strike = row.contract_strike;
  if (!expiry || strike == null || !Number.isFinite(strike)) return null;
  const right = row.contract_type === "put" ? "P" : "C";
  const dte = calendarDte(etYmd(), expiry.slice(0, 10));
  const score =
    row.feature_vector && typeof row.feature_vector.evidence_score === "number"
      ? (row.feature_vector.evidence_score as number)
      : 0;
  const exitPnl = fin(row.realized_pnl_pct);
  return {
    positionId: row.id,
    ticker: row.ticker.toUpperCase(),
    direction: row.direction === "short" ? "SHORT" : "LONG",
    horizon: "SWING",
    score,
    status: "CLOSED",
    reason: `closed — ${row.archetype ?? "swing"} thesis`,
    contract: {
      strike,
      right,
      expiry,
      dte,
      mid: row.last_mark,
      delta: row.contract_delta,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
    },
    archetype: row.archetype,
    subLane: row.sub_lane,
    firstSeenAt: row.first_seen_at,
    committedAt: row.committed_at,
    entryPremium: row.entry_premium,
    peakPremium: row.peak_premium,
    troughPremium: row.trough_premium,
    occ: row.contract_occ,
    exitAt: row.closed_at ?? row.graded_at,
    exitPnlPct: exitPnl,
    closedReason: closedReasonFromRow(row),
  };
}

/**
 * From roll chains already loaded for the record API: one CLOSED deck row per resolved chain
 * (terminal leg graded + CLOSED). Sorted newest exit first.
 */
export function closedDeckSourcesFromChains(chains: readonly SwingPositionRow[][]): SwingClosedDeckSource[] {
  const out: SwingClosedDeckSource[] = [];
  const seen = new Set<number>();
  for (const chain of chains) {
    const ordered = [...chain].sort((a, b) => a.roll_seq - b.roll_seq || a.id - b.id);
    const terminal = ordered[ordered.length - 1];
    if (!terminal) continue;
    const src = closedDeckSourceFromRow(terminal);
    if (!src || seen.has(src.positionId)) continue;
    seen.add(src.positionId);
    out.push(src);
  }
  return out.sort((a, b) => {
    const at = Date.parse(a.exitAt ?? "") || 0;
    const bt = Date.parse(b.exitAt ?? "") || 0;
    return bt - at;
  });
}

/** Score floor constant for closed rows — matches live horizon plays. */
export const SWING_CLOSED_SCORE_FLOOR = HORIZONS.SWING.scoreFloor;
