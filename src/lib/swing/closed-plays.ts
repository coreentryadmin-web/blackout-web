// src/lib/swing/closed-plays.ts — map graded CLOSED ledger rows onto deck payloads (CLOSED tab parity).
//
// The horizons lane serves pre-entry + live open book; this mapper covers the third bucket members
// expect from 0DTE parity: finished swing positions with realized P&L. PURE — callers supply DB rows.

import type { SwingPositionRow } from "../db";
import { calendarDte } from "../horizon-fanout";
import { HORIZONS } from "../horizons";
import { buildSwingRecord } from "./record";

const fin = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);
const round2 = (n: number): number => Math.round(n * 100) / 100;

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
  /** Raw entry_context.cortex JSONB — parsed structurally by the adapter (readCortexView),
   *  never trusted here. Carries the Cortex evidence pinned at commit, when one exists. */
  cortex?: unknown;
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
  // FINDINGS 2026-09-06 (swing-closed-dte-negative): a CLOSED position's DTE must be frozen to its
  // own trade lifecycle, never recomputed against "now". The ledger carries no dedicated
  // dte-at-entry/dte-at-exit column, but it DOES carry the exit timestamp (closed_at, falling back to
  // graded_at for legacy rows graded without a distinct close stamp) — so "days to expiry as of the
  // day this trade actually closed" is available for free and is the only DTE reading that stays
  // stable no matter when the record is viewed later. Using etYmd() (today) here previously produced
  // a negative DTE for any contract that has since expired (e.g. EWZ/GLW: expiry 2026-09-04, dte -2
  // when read on 2026-09-06) and a wrong-but-plausible-looking number for anything still short of
  // expiry (AAPL: true DTE at exit was 5, but the live-recomputed value read 3 and silently kept
  // shrinking on every subsequent view).
  const exitAt = row.closed_at ?? row.graded_at;
  const dte = calendarDte((exitAt ?? etYmd()).slice(0, 10), expiry.slice(0, 10));
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
    exitAt,
    exitPnlPct: exitPnl,
    closedReason: closedReasonFromRow(row),
    cortex: row.entry_context?.cortex ?? null,
  };
}

/**
 * From roll chains already loaded for the record API: one CLOSED deck row per resolved chain
 * (terminal leg graded + CLOSED). Uses chain-composite P&L/outcome (deep-dive Q26), not terminal leg only.
 */
export function closedDeckSourcesFromChains(chains: readonly SwingPositionRow[][]): SwingClosedDeckSource[] {
  const out: SwingClosedDeckSource[] = [];
  const seen = new Set<number>();
  for (const chain of chains) {
    const ordered = [...chain].sort((a, b) => a.roll_seq - b.roll_seq || a.id - b.id);
    const terminal = ordered[ordered.length - 1];
    if (!terminal) continue;
    const record = buildSwingRecord(ordered);
    if (!record.composite.chainResolved) continue;
    const src = closedDeckSourceFromRow(terminal);
    if (!src || seen.has(src.positionId)) continue;
    seen.add(src.positionId);
    const compositePnl = record.composite.worstLegPnlPct;
    // BUG FIX (2026-09-13, Ask Largo standing mandate, live repro NFLX#12/WULF#13/IGV#16/WULF#17/
    // PYPL#24): `record.composite.outcome` is deliberately conservative — `isSwingWin` requires
    // `pnl > 0`, so a leg that closed at EXACTLY its entry price (pnl === 0, a true flat/breakeven
    // close, not a rounding artifact) makes `allLegsWon` false, which the composite unconditionally
    // reports as `"loss"` (record.ts's own "preserved-loss invariant" — a leg that didn't WIN is
    // treated as not-won for win-rate purposes, a defensible, intentionally strict scoring choice
    // this fix does NOT change). But this function then mapped `"loss"` straight to the closedReason
    // LABEL `"stopped"` — which is not conservative, it's factually wrong: "stopped" means a
    // stop-loss actually fired, and a position that closed unchanged from entry never triggered one.
    // All five live examples confirmed `entryPremium === peakPremium === troughPremium` (the premium
    // never moved even a cent across the whole holding period) yet displayed "stopped" — misleading
    // members reading trade history, and silently corrupting win-rate/track-record math that reads
    // `closedReason` as a stop-vs-target signal. The sibling single-leg mapper (`closedReasonFromRow`
    // just above) already gets this right with a real three-way split (target/stopped/flat) — this
    // brings the chain-composite path in line with it, changing ONLY the label text for the exact-0
    // case, not the win/loss scoring semantics `record.ts` documents as intentional.
    const compositeReason =
      record.composite.outcome === "win"
        ? "target"
        : record.composite.outcome === "loss"
          ? compositePnl === 0
            ? "flat"
            : "stopped"
          : src.closedReason;
    // BUG FIX (2026-09-15, Ask Largo standing mandate, forensic batch 31, live repro INTC:30/35):
    // `exitPnlPct` above is the chain-COMPOSITE worst-leg P&L (by design — the preserved-loss
    // invariant, record.ts's own file header), but `entryPremium`/`peakPremium`/`troughPremium`
    // come from `src`, which is the TERMINAL leg only (`closedDeckSourceFromRow(terminal)` above).
    // Whenever the worst leg is an EARLIER leg (a rolled chain where the parent lost more than the
    // child), those two halves describe different legs entirely — live: INTC's served row paired
    // leg 1's own price bounds (entry 2.26 -> peak 2.84, i.e. "+25.7% at peak") with leg 0's -40.83%
    // realized loss, so peak-vs-entry computed a POSITIVE 25.7% next to a reported -40.83% exit, and
    // that "peak" chronologically postdates the loss it's shown beside (leg 1 didn't exist until
    // leg 0's roll). Downstream, `primaryReturnPct` (play-card-display.ts) prefers `peak` as the
    // CLOSED-tab headline number, so this fabricated a green "+25.7%" card for a chain whose real
    // worst outcome was a loss. The single-leg play-brief path (`play-brief-resolve.ts`) already
    // avoids this by construction (it never applies the chain-composite override) — this brings the
    // list-view/Closed-tab path in line: when the worst leg isn't the terminal leg, the terminal's
    // own price bounds don't correspond to the P&L being reported, so omit them (honest omission,
    // per this codebase's own absence principle) rather than pair a real number with the wrong leg's
    // journey. `primaryReturnPct` already has a clean fallback to the actual exit P&L when peak is
    // null (play-card-display.ts:72-73), so this is a safe no-crash path, not just a null-check.
    const terminalPnl = fin(terminal.realized_pnl_pct);
    const worstLegIsTerminal =
      compositePnl != null && terminalPnl != null && round2(terminalPnl) === compositePnl;
    out.push({
      ...src,
      exitPnlPct: compositePnl ?? src.exitPnlPct,
      entryPremium: worstLegIsTerminal ? src.entryPremium : null,
      peakPremium: worstLegIsTerminal ? src.peakPremium : null,
      troughPremium: worstLegIsTerminal ? src.troughPremium : null,
      closedReason: compositeReason,
      reason: `${src.reason} · chain composite (${record.composite.gradedLegs} leg${record.composite.gradedLegs === 1 ? "" : "s"})`,
    });
  }
  return out.sort((a, b) => {
    const at = Date.parse(a.exitAt ?? "") || 0;
    const bt = Date.parse(b.exitAt ?? "") || 0;
    return bt - at;
  });
}

/** Score floor constant for closed rows — matches live horizon plays. */
export const SWING_CLOSED_SCORE_FLOOR = HORIZONS.SWING.scoreFloor;
