"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSpotStreamEventSource, type SpotStreamQuote } from "@/lib/api";

export type LiveQuote = SpotStreamQuote;

/**
 * Live (push, ~1s) spot price + day-change% for a set of stock/ETF tickers —
 * PR 3 of the sub-second-spot project (see FINDINGS.md): components on 1-2s
 * SWR polling migrate to this hook one at a time.
 *
 * One SSE connection is opened for the CURRENT ticker set; passing a
 * differently-ordered-but-same array does not reopen the connection (the
 * ticker set is sorted+joined into a stable key before comparing). Passing a
 * genuinely different set of tickers closes the old connection and opens a
 * new one for the new set.
 *
 * A ticker absent from `quotes` means the server hasn't seen a live tick for
 * it yet (freshly requested, off-hours, or an invalid symbol) — callers
 * should keep showing their last-known REST/SWR value until it appears here,
 * not treat a missing key as "price is now unknown."
 */
export function useLiveQuoteStream(tickers: string[]): {
  quotes: Record<string, LiveQuote>;
  connected: boolean;
} {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [connected, setConnected] = useState(false);

  // Stable key so an unchanged ticker SET (regardless of array identity/order)
  // does not tear down and reopen the EventSource on every render.
  const tickerKey = useMemo(
    () => Array.from(new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))).sort().join(","),
    [tickers]
  );

  const tickerListRef = useRef<string[]>([]);
  tickerListRef.current = tickerKey ? tickerKey.split(",") : [];

  useEffect(() => {
    if (!tickerKey) {
      setQuotes({});
      setConnected(false);
      return;
    }
    // Reset — a genuinely different ticker set should not show stale prices
    // for tickers no longer being watched.
    setQuotes({});

    const conn = createSpotStreamEventSource(
      tickerListRef.current,
      (frame) => {
        setQuotes((prev) => ({ ...prev, ...frame.quotes }));
      },
      {
        onOpen: () => setConnected(true),
        onClose: () => setConnected(false),
      }
    );

    return () => {
      conn?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tickerKey fully captures the ticker set
  }, [tickerKey]);

  return { quotes, connected };
}
