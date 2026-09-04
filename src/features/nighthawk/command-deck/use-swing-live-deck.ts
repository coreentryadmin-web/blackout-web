"use client";

import { useMemo } from "react";
import type { TerminalPlay } from "./types";
import { useZeroDteLiveMarks, overlayLiveMarks } from "./use-live-marks";
import { overlayHorizonWatchTrack } from "./use-live-marks";
import { useLegacyStockQuotes } from "./use-legacy-quotes";
import { capQuoteTickers, ZERODTE_QUOTE_MAX_TICKERS, ZERODTE_QUOTE_POLL_MS } from "./use-zero-dte-live-deck";

const WORKING = new Set(["OPEN", "HOLD", "TRIM"]);

/**
 * Live overlay for Swing Command — reuses the shared marks SSE lane (now includes swing OCCs)
 * plus underlying quotes for WATCH track + working rows.
 */
export function useSwingLiveDeck(basePlays: TerminalPlay[]): TerminalPlay[] {
  const liveMarks = useZeroDteLiveMarks(true);
  const tickers = useMemo(() => {
    const working = basePlays.filter((p) => WORKING.has(String(p.status ?? "").toUpperCase()));
    const watch = basePlays.filter((p) => p.status === "WATCH" || p.status === "SKIP");
    return capQuoteTickers([...working, ...watch], ZERODTE_QUOTE_MAX_TICKERS);
  }, [basePlays]);
  const stockQuotes = useLegacyStockQuotes(tickers, tickers.length > 0, ZERODTE_QUOTE_POLL_MS);
  return useMemo(() => {
    const withMarks = overlayLiveMarks(basePlays, liveMarks);
    return overlayHorizonWatchTrack(withMarks, stockQuotes);
  }, [basePlays, liveMarks, stockQuotes]);
}
