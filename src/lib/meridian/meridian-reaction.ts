import "server-only";

import { fetchIndexDailyBars, fetchStockDailyBars } from "@/lib/providers/polygon";
import { serverCache } from "@/lib/server-cache";
import { reactionsForDates, type DailyBarLike, type SessionReaction } from "@/lib/meridian/meridian-reaction-core";

const REACTION_CACHE_MS = 30 * 60 * 1000;

async function loadIndexBars(from: string, to: string): Promise<DailyBarLike[]> {
  return serverCache(`meridian:bars:I:SPX:${from}:${to}`, REACTION_CACHE_MS, () =>
    fetchIndexDailyBars("I:SPX", from, to, "400").catch(() => [])
  );
}

async function loadStockBars(ticker: string, from: string, to: string): Promise<DailyBarLike[]> {
  const sym = ticker.toUpperCase();
  return serverCache(`meridian:bars:${sym}:${from}:${to}`, REACTION_CACHE_MS, () =>
    fetchStockDailyBars(sym, from, to, "120").catch(() => [])
  );
}

function ymdDaysBefore(anchorYmd: string, daysBack: number): string {
  const [y, m, d] = anchorYmd.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d - daysBack));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function barWindowForDates(dates: string[]): { from: string; to: string } {
  const sorted = [...dates].filter(Boolean).sort();
  const oldest = sorted[0];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  if (!oldest) return { from: ymdDaysBefore(today, 90), to: today };
  return { from: ymdDaysBefore(oldest, 14), to: today };
}

/** SPX session + next-day reactions for macro/OpEx dates (Polygon index bars). */
export async function spxReactionsForDates(
  dates: string[]
): Promise<Map<string, SessionReaction>> {
  if (!dates.length) return new Map();
  const { from, to } = barWindowForDates(dates);
  const bars = await loadIndexBars(from, to);
  return reactionsForDates(bars, dates);
}

/** Underlying session + next-day reactions for earnings/FDA dates. */
export async function stockReactionsForDates(
  ticker: string,
  dates: string[]
): Promise<Map<string, SessionReaction>> {
  if (!dates.length || !ticker.trim()) return new Map();
  const { from, to } = barWindowForDates(dates);
  const bars = await loadStockBars(ticker, from, to);
  return reactionsForDates(bars, dates);
}
