"use client";

import { useMemo } from "react";
import type { TerminalPlay } from "./types";
import { refreshSwingManagement } from "./adapters";
import { useZeroDteLiveMarks, overlayLiveMarks } from "./use-live-marks";
import { overlayHorizonWatchTrack } from "./use-live-marks";
import { useLegacyStockQuotes } from "./use-legacy-quotes";
import { useSecondTick } from "./use-deck-live";
import { formatComputedEt } from "@/lib/zerodte/thesis-health";
import {
  capQuoteTickers,
  ZERODTE_QUOTE_MAX_TICKERS,
  ZERODTE_QUOTE_POLL_MS,
} from "./use-zero-dte-live-deck";

const WORKING = new Set(["OPEN", "HOLD", "TRIM"]);

/**
 * Live overlay for Swing Command — marks SSE (~1s) + underlying quotes + 1 Hz management/thesis refresh.
 * Parity with useZeroDteLiveDeck for open capital rows.
 */
export function useSwingLiveDeck(basePlays: TerminalPlay[]): TerminalPlay[] {
  const liveMarks = useZeroDteLiveMarks(true);
  const tickers = useMemo(() => {
    const working = basePlays.filter((p) => WORKING.has(String(p.status ?? "").toUpperCase()));
    const watch = basePlays.filter((p) => p.status === "WATCH" || p.status === "SKIP");
    return capQuoteTickers([...working, ...watch], ZERODTE_QUOTE_MAX_TICKERS);
  }, [basePlays]);
  const stockQuotes = useLegacyStockQuotes(tickers, tickers.length > 0, ZERODTE_QUOTE_POLL_MS);
  const nowMs = useSecondTick();

  return useMemo(() => {
    const withMarks = overlayLiveMarks(basePlays, liveMarks);
    const withTrack = overlayHorizonWatchTrack(withMarks, stockQuotes);
    const computedAtEt = formatComputedEt(nowMs);
    return withTrack.map((p) => {
      const withClock =
        p.thesisHealth != null
          ? { ...p, thesisHealth: { ...p.thesisHealth, computedAtEt } }
          : p;
      return refreshSwingManagement(withClock);
    });
  }, [basePlays, liveMarks, stockQuotes, nowMs]);
}
