"use client";

import { useMemo } from "react";
import type { TerminalPlay } from "./types";
import { refreshZeroDteManagement } from "./adapters";
import { useZeroDteLiveMarks, overlayLiveMarks, overlayZeroDteStockQuotes } from "./use-live-marks";
import { useLegacyStockQuotes } from "./use-legacy-quotes";
import { useSecondTick } from "./use-deck-live";
import { formatComputedEt } from "@/lib/zerodte/thesis-health";

/**
 * RTH cadence for underlying quotes on open 0DTE plays.
 *
 * Was 1_000 (matching the marks SSE). That was safe when the 0DTE board was a handful of rows, but
 * `useLegacyStockQuotes` fans out ONE `/api/market/quote?ticker=X` request PER TICKER PER TICK, so
 * the request rate is `rowCount / pollMs`. Once BREAKOUT dynamic-N (floor 40, ceiling 100) started
 * returning ~100-row boards, a single open tab demanded ~106 req/SECOND against an uncacheable,
 * Clerk-authenticated route — which is what saturated the web tier on 2026-08-06 (see FINDINGS).
 * 10s is the underlying-price refresh for a DISPLAY-ONLY field (see the cap comment below); the
 * option MARK that actually drives P&L/management still streams at ~1s over the marks SSE.
 */
export const ZERODTE_QUOTE_POLL_MS = 10_000;

/**
 * Hard cap on how many tickers the per-ticker quote poll is allowed to cover.
 *
 * 60 is deliberately the SAME number as the server's `MAX_TICKERS_PER_STREAM`
 * (src/lib/ws/stocks-spot-stream-hub.ts) — `useLegacyStockQuotes` hands this same ticker list to
 * the bulk spot-stream SSE, and the server 400s ("Too many tickers (max 60)") above that. On a
 * 100+ row board the efficient push lane was therefore DEAD (and reconnect-looping forever), which
 * is why 100% of the spot load had fallen onto the REST fan-out. Capping at 60 restores the single
 * bulk SSE connection AND bounds the REST fan-out.
 *
 * The constant is duplicated here on purpose rather than imported: that hub module pulls in
 * server-side candle-store code, and this is a "use client" bundle.
 */
export const ZERODTE_QUOTE_MAX_TICKERS = 60;

/** Rows that represent real committed capital — these must never lose their live underlying. */
const WORKING_STATUSES = new Set(["OPEN", "HOLD", "TRIM"]);

/**
 * Pick which tickers get the per-ticker live quote, bounded by `max`.
 *
 * Working rows (OPEN/HOLD/TRIM) go FIRST: they are the member's live positions, and a ledger-only
 * row (a working position the current scan no longer surfaces) carries NO `underlying_price` in the
 * board payload, so it has no fallback price to fall back to. Ranked candidates beyond the cap keep
 * the board's own `underlying_price` (seeded at adapters.ts `stockPrice`), so they degrade to
 * board-cadence freshness rather than going blank.
 *
 * Pure + order-stable so it is unit-testable; selects nothing but which prices are refreshed.
 */
export function capQuoteTickers(
  plays: Array<{ ticker: string; status?: string | null }>,
  max: number = ZERODTE_QUOTE_MAX_TICKERS,
): string[] {
  const working: string[] = [];
  const rest: string[] = [];
  const seen = new Set<string>();
  for (const p of plays) {
    const tk = p.ticker;
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    (WORKING_STATUSES.has(String(p.status ?? "").toUpperCase()) ? working : rest).push(tk);
  }
  return [...working, ...rest].slice(0, Math.max(0, max));
}

/**
 * Unified live overlay for the 0DTE Command Deck: marks SSE (~1s) + stock quotes (10s, capped) +
 * management/thesis advisory refresh every tick. Board SWR (1s RTH) carries thesis health + gates.
 */
export function useZeroDteLiveDeck(basePlays: TerminalPlay[], sim: boolean): TerminalPlay[] {
  const liveMarks = useZeroDteLiveMarks(!sim);
  const tickers = useMemo(
    () => capQuoteTickers(basePlays, ZERODTE_QUOTE_MAX_TICKERS),
    [basePlays],
  );
  const stockQuotes = useLegacyStockQuotes(tickers, !sim && tickers.length > 0, ZERODTE_QUOTE_POLL_MS);
  const nowMs = useSecondTick();

  return useMemo(() => {
    let plays = overlayLiveMarks(basePlays, sim ? new Map() : liveMarks);
    plays = overlayZeroDteStockQuotes(plays, stockQuotes);
    const computedAtEt = formatComputedEt(nowMs);
    plays = plays.map((p) => {
      const withClock =
        p.thesisHealth != null
          ? { ...p, thesisHealth: { ...p.thesisHealth, computedAtEt } }
          : p;
      return refreshZeroDteManagement(withClock);
    });
    return plays;
  }, [basePlays, liveMarks, stockQuotes, nowMs, sim]);
}
