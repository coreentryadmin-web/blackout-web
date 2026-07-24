// ── BREAKOUT discovery — IO orchestration (Phase 3a) ──────────────────────────────
// The provider-touching half of the BREAKOUT source (the pure half is breakout-source.ts).
// Dynamic-imported from scan.ts ONLY when the source is flag-enabled, so the flow-only board
// never loads the whole-market provider graph (grouped-daily breadth + per-ticker option chain).
//
// INTRADAY BREADTH SOURCING (the design's mandatory adaptation, §1a): the edition's banger lane
// feeds screenBreakoutMovers a grouped-daily bar of a FINISHED session. Intraday that would be a
// stale prior-day bar. Here we read TODAY's grouped-daily summary — during RTH Polygon returns
// the LIVE, still-incomplete current-session bar (real session open + accumulating h/l/c/v), which
// is exactly the live intraday snapshot we want. Off-hours / pre-open that call returns EMPTY, and
// we SKIP (return [], logged) rather than feed the screen a stale bar. We also gate to the RTH
// commit window so a completed after-close "today" bar is never treated as live.

import { fetchDailyMarketSummary } from "@/lib/providers/polygon";
import { screenBreakoutMovers } from "@/features/nighthawk/lib/candidates";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import {
  buildBreakoutSetup,
  pickAtmZeroDteContract,
  type BreakoutChainRow,
} from "./breakout-source";
import type { EnrichedZeroDteSetup } from "./board";

/** RTH commit window in ET minutes-since-midnight: [9:30, 15:00). Outside it the board opens no
 *  fresh plays anyway (persistZeroDteScan cutoff), so the breakout source stays idle rather than
 *  risk reading a not-yet-live (pre-open) or completed (after-close) "today" grouped bar. */
const RTH_OPEN_ET_MINUTES = 9 * 60 + 30;
const RTH_CUTOFF_ET_MINUTES = 15 * 60;

/** Cap the per-ticker chain fetches per scan — the screen returns the top-$-volume movers already;
 *  a handful is enough to widen the funnel without a chain-fetch storm. */
export const BREAKOUT_MAX_CANDIDATES = 6;

/**
 * Discover BREAKOUT-origin setups for the live board. Returns [] (a logged SKIP) whenever no live
 * intraday breadth snapshot exists — off-hours, pre-open, or a provider miss — so the source never
 * fabricates candidates from stale data. Best-effort throughout: any failure degrades to [] and the
 * flow board is untouched.
 */
export async function discoverBreakoutSetups(opts: {
  today: string;
  nowEtMinutes: number;
  /** Tickers to exclude (static excludes + Night Hawk-covered names), same set the flow path uses. */
  excludeTickers: Set<string>;
  maxCandidates?: number;
}): Promise<EnrichedZeroDteSetup[]> {
  const { today, nowEtMinutes, excludeTickers } = opts;
  const maxCandidates = opts.maxCandidates ?? BREAKOUT_MAX_CANDIDATES;

  if (nowEtMinutes < RTH_OPEN_ET_MINUTES || nowEtMinutes >= RTH_CUTOFF_ET_MINUTES) {
    console.info("[zerodte-breakout] outside the RTH commit window — SKIP (no live intraday breadth)");
    return [];
  }

  // TODAY's grouped-daily = the LIVE incomplete session bar during RTH (never a prior-day bar).
  const summary = await fetchDailyMarketSummary(today).catch(() => null);
  const results = summary?.results ?? [];
  if (results.length === 0) {
    console.info("[zerodte-breakout] no live intraday breadth snapshot (empty grouped-daily) — SKIP");
    return [];
  }

  const movers = screenBreakoutMovers(results).filter(
    (m) => !excludeTickers.has(m.ticker.toUpperCase())
  );
  if (movers.length === 0) {
    console.info("[zerodte-breakout] breadth snapshot present but zero qualifying breakouts — SKIP");
    return [];
  }

  // Normalize $-volume against THIS cohort's max (like candidates.ts normalizeToMax) so the score's
  // liquidity term is comparable within the scan; the screen already sorted by $-volume desc.
  const maxDollar = movers.reduce((m, x) => Math.max(m, x.dollar), 0);
  const top = movers.slice(0, maxCandidates);

  // Fetch each candidate's live chain, pick an ATM 0DTE (weekly fallback) contract, and build the
  // seed setup. A candidate with no liquid same-day/weekly contract is DROPPED here (no fabricated
  // plan) — and even a picked contract still runs the mandatory attachContractPlans gate downstream.
  const built = await Promise.all(
    top.map(async (mover): Promise<EnrichedZeroDteSetup | null> => {
      try {
        const chain = await resolveTickerChainRows(mover.ticker).catch(() => null);
        if (!chain || !(chain.spot > 0) || chain.rows.length === 0) return null;
        const rows: BreakoutChainRow[] = chain.rows.map((r) => ({
          expiry: r.expiry,
          strike: r.strike,
          call_bid: r.call_bid,
          call_ask: r.call_ask,
          call_oi: r.call_oi,
        }));
        const contract = pickAtmZeroDteContract(rows, chain.spot, today);
        if (!contract) return null;
        const dollarNorm = maxDollar > 0 ? mover.dollar / maxDollar : 0;
        return buildBreakoutSetup({ mover, spot: chain.spot, contract, dollarNorm });
      } catch {
        return null; // best-effort per ticker — one bad chain never sinks the batch
      }
    })
  );

  const setups = built.filter((s): s is EnrichedZeroDteSetup => s != null);
  console.info(
    `[zerodte-breakout] ${movers.length} qualifying breakouts, built ${setups.length} setup(s) from top ${top.length}`
  );
  return setups;
}
