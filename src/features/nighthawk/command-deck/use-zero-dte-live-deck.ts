"use client";

import { useMemo } from "react";
import type { TerminalPlay } from "./types";
import { refreshZeroDteManagement } from "./adapters";
import { useZeroDteLiveMarks, overlayLiveMarks, overlayZeroDteStockQuotes } from "./use-live-marks";
import { useLegacyStockQuotes } from "./use-legacy-quotes";
import { useSecondTick } from "./use-deck-live";
import { formatComputedEt } from "@/lib/zerodte/thesis-health";

/** RTH cadence for underlying quotes on open 0DTE plays — matches marks SSE (~1s). */
export const ZERODTE_QUOTE_POLL_MS = 1_000;

/**
 * Unified live overlay for the 0DTE Command Deck: marks SSE (~1s) + stock quotes (1s) +
 * management/thesis advisory refresh every tick. Board SWR (1s RTH) carries thesis health + gates.
 */
export function useZeroDteLiveDeck(basePlays: TerminalPlay[], sim: boolean): TerminalPlay[] {
  const liveMarks = useZeroDteLiveMarks(!sim);
  const tickers = useMemo(
    () => [...new Set(basePlays.map((p) => p.ticker).filter(Boolean))],
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
