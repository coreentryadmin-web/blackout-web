"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TerminalPlay } from "./types";
import { parseLevelNum } from "./adapters";
import { useLiveQuoteStream } from "@/hooks/useLiveQuoteStream";

interface StockQuote {
  price: number;
  changePct: number;
  asof: string;
  sessionHigh: number;
  sessionLow: number;
}

const POLL_MS = 5_000;

/**
 * Polls /api/market/quote for each unique Legacy ticker (~5s), overlaid with the sub-second
 * stock/ETF push stream (PR 3/N of the sub-second-spot project — see FINDINGS.md; same
 * stock-candle-store WS feed GexHeatmap/ThermalTripleDesk already read from). Returns
 * Map<ticker, StockQuote>. Only active during market hours (the endpoint handles off-hours
 * gracefully — returns last available). Deduplicates tickers so 5 plays = at most 5 concurrent
 * REST fetches (shared-cached server-side at 1.5s) plus one shared SSE connection for all of them.
 *
 * Unlike GexHeatmap/ThermalTripleDesk's header-only overlay, both sources feed the SAME
 * observed-price pipeline here (not a display-only overlay): a push tick and a REST poll are
 * both "the stock moved to $X at time T" and update sessionHigh/sessionLow + trigger the
 * overlayLegacyQuotes stop/target-crossing check identically. This is intentional — Legacy's
 * progress bars and stop/target recommendation should react to an intra-5s stop/target breach
 * as soon as the push stream reports it, not wait for the next 5s REST poll.
 */
export function useLegacyStockQuotes(tickers: string[], enabled = true, pollMs = POLL_MS): Map<string, StockQuote> {
  const [quotes, setQuotes] = useState<Map<string, StockQuote>>(() => new Map());
  const key = tickers.join(",");
  const uniqueTickers = useMemo(() => (enabled ? [...new Set(tickers)] : []), [key, enabled]);

  const applyObservedPrice = useCallback(
    (ticker: string, price: number, changePct: number, asof: string) => {
      setQuotes((prev) => {
        const old = prev.get(ticker);
        if (old && old.asof === asof && old.price === price) return prev;
        const next = new Map(prev);
        next.set(ticker, {
          price,
          changePct,
          asof,
          sessionHigh: Math.max(price, old?.sessionHigh ?? price),
          sessionLow: Math.min(price, old?.sessionLow ?? price),
        });
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!enabled || tickers.length === 0) return;

    let cancelled = false;
    // Re-entrancy guard (same pattern as use-live-marks.ts's REST fallback). `setInterval` fires
    // regardless of whether the previous fan-out finished, so when the origin is slow every tick
    // stacked ANOTHER N requests on top of the unfinished ones — positive feedback that turns a
    // slowdown into a pile-up (2026-08-06 incident: ~110s TargetResponseTime, so ~110 overlapping
    // fan-outs per client). Skipping a tick while one is in flight can only reduce concurrent
    // requests; it never changes a quote value.
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const unique = [...new Set(tickers)];
        const results = await Promise.allSettled(
          unique.map(async (tk) => {
            const r = await fetch(`/api/market/quote?ticker=${encodeURIComponent(tk)}`, {
              cache: "no-store",
              credentials: "same-origin",
            });
            if (!r.ok) return null;
            const d = await r.json();
            if (!d?.available || !(d.price > 0)) return null;
            return { ticker: tk, price: d.price as number, changePct: d.change_pct as number, asof: d.asof as string };
          }),
        );

        if (cancelled) return;

        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            applyObservedPrice(r.value.ticker, r.value.price, r.value.changePct, r.value.asof);
          }
        }
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const id = setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key, enabled, pollMs, applyObservedPrice]);

  // Sub-second overlay: a fresh push tick is treated as an observed price exactly like a REST
  // poll result — see the doc comment above for why (progress/stop/target reacts immediately).
  const { quotes: pushQuotes } = useLiveQuoteStream(uniqueTickers);
  useEffect(() => {
    for (const [ticker, q] of Object.entries(pushQuotes)) {
      if (q.price > 0) applyObservedPrice(ticker, q.price, q.changePct, q.asof);
    }
  }, [pushQuotes, applyObservedPrice]);

  return quotes;
}

/**
 * Overlay live stock quotes onto Legacy TerminalPlay[] — computes stock-level progress
 * (how far the stock has moved from entry toward target/stop) and updates the management
 * track so the terminal shows a live position gauge.
 *
 * Pure function: given plays + stock quotes + the original play data (for target/stop parsing),
 * returns new TerminalPlay[] with progress + regime note populated.
 */
export function overlayLegacyQuotes(
  plays: TerminalPlay[],
  quotes: Map<string, StockQuote>,
  originals: Array<{ ticker: string; target?: string | null; stop?: string | null; entry_range?: string | null }>,
): TerminalPlay[] {
  if (quotes.size === 0) return plays;

  return plays.map((p, i) => {
    const q = quotes.get(p.ticker);
    if (!q) return p;

    const orig = originals[i];
    if (!orig) return p;

    const target = parseLevelNum(orig.target);
    const stop = parseLevelNum(orig.stop);
    const entryMid = parseEntryRangeMid(orig.entry_range);

    if (!entryMid) return { ...p, markAsOf: q.asof };

    const isLong = p.direction === "LONG";

    let progress: number | null = null;
    if (target != null && stop != null && target !== stop) {
      if (isLong) {
        const range = target - stop;
        progress = range > 0 ? Math.max(0, Math.min(1, (q.price - stop) / range)) : null;
      } else {
        const range = stop - target;
        progress = range > 0 ? Math.max(0, Math.min(1, (stop - q.price) / range)) : null;
      }
    }

    const distTarget = target != null ? ((target - q.price) / q.price * 100).toFixed(1) : null;
    const distStop = stop != null ? ((stop - q.price) / q.price * 100).toFixed(1) : null;

    const stockNote = [
      `${p.ticker} $${q.price.toFixed(2)} (${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}%)`,
      distTarget != null ? `target ${Number(distTarget) >= 0 ? "+" : ""}${distTarget}%` : null,
      distStop != null ? `stop ${Number(distStop) >= 0 ? "+" : ""}${distStop}%` : null,
    ].filter(Boolean).join(" · ");

    const enrichedRecNote = p.recNote
      ? `${p.recNote} — ${stockNote}`
      : stockNote;

    // Stock-level P&L: how far the stock moved from entry mid in the play's direction.
    const stockPnlPct = entryMid > 0
      ? isLong
        ? ((q.price - entryMid) / entryMid) * 100
        : ((entryMid - q.price) / entryMid) * 100
      : null;

    // Dynamic recommendation: when the stock breaches stop or target, override the static
    // morning-confirmation recommendation so the manage tab gives real-time guidance.
    let recommendation = p.recommendation;
    let recNote = enrichedRecNote;
    if (target != null && stop != null && p.status !== "CLOSED" && p.status !== "SKIP") {
      const atStop = isLong ? q.price <= stop : q.price >= stop;
      const atTarget = isLong ? q.price >= target : q.price <= target;
      if (atStop) {
        recommendation = "SELL";
        recNote = `Stock at stop level ($${stop.toFixed(2)}) — cut the position to preserve capital.`;
      } else if (atTarget) {
        recommendation = "TRIM";
        recNote = `Stock at target ($${target.toFixed(2)}) — take profit or trail the stop.`;
      }
    }

    // Session excursion: convert session high/low to P&L% from entry for ExcursionViz.
    let peak: number | null = null;
    let trough: number | null = null;
    if (entryMid > 0) {
      if (isLong) {
        peak = ((q.sessionHigh - entryMid) / entryMid) * 100;
        trough = ((q.sessionLow - entryMid) / entryMid) * 100;
      } else {
        peak = ((entryMid - q.sessionLow) / entryMid) * 100;
        trough = ((entryMid - q.sessionHigh) / entryMid) * 100;
      }
    }

    return {
      ...p,
      progress,
      pnlPct: stockPnlPct != null && Number.isFinite(stockPnlPct) ? Number(stockPnlPct.toFixed(2)) : null,
      peak: peak != null && Number.isFinite(peak) ? Number(peak.toFixed(2)) : null,
      trough: trough != null && Number.isFinite(trough) ? Number(trough.toFixed(2)) : null,
      recommendation,
      recNote,
      markAsOf: q.asof,
      stockPrice: q.price,
      stockChangePct: q.changePct,
    };
  });
}

function parseEntryRangeMid(range: string | null | undefined): number | null {
  if (!range) return null;
  // Strip "condition | $range" prefix — only parse the numeric band after the last `|`.
  const text = range.includes("|") ? range.slice(range.lastIndexOf("|") + 1) : range;
  const nums = (text.match(/[\d.]+/g) ?? []).map(Number).filter(Number.isFinite);
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  return (nums[0] + nums[nums.length - 1]) / 2;
}
