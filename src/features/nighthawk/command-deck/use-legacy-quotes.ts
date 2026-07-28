"use client";

import { useEffect, useState } from "react";
import type { TerminalPlay } from "./types";
import { parseLevelNum } from "./adapters";

interface StockQuote {
  price: number;
  changePct: number;
  asof: string;
}

const POLL_MS = 5_000;

/**
 * Polls /api/market/quote for each unique Legacy ticker (~5s). Returns a Map<ticker, StockQuote>.
 * Only active during market hours (the endpoint handles off-hours gracefully — returns last
 * available). Deduplicates tickers so 5 plays = at most 5 concurrent fetches (shared-cached
 * server-side at 1.5s, so the real upstream pressure is minimal).
 */
export function useLegacyStockQuotes(tickers: string[], enabled = true): Map<string, StockQuote> {
  const [quotes, setQuotes] = useState<Map<string, StockQuote>>(() => new Map());
  const key = tickers.join(",");

  useEffect(() => {
    if (!enabled || tickers.length === 0) return;

    let cancelled = false;

    const poll = async () => {
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

      const next = new Map<string, StockQuote>();
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          next.set(r.value.ticker, { price: r.value.price, changePct: r.value.changePct, asof: r.value.asof });
        }
      }
      if (next.size > 0) setQuotes(next);
    };

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key, enabled]);

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
    const entryMid = parseLevelNum(orig.entry_range?.match(/[\d.]+/)?.[0] ? orig.entry_range : null)
      ?? parseEntryRangeMid(orig.entry_range);

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

    return {
      ...p,
      progress,
      pnlPct: stockPnlPct != null && Number.isFinite(stockPnlPct) ? Number(stockPnlPct.toFixed(2)) : null,
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
  const nums = (range.match(/[\d.]+/g) ?? []).map(Number).filter(Number.isFinite);
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  return (nums[0] + nums[nums.length - 1]) / 2;
}
