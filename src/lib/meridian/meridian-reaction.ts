import "server-only";

import { fetchIndexDailyBars, fetchStockDailyBars } from "@/lib/providers/polygon";
import { serverCache } from "@/lib/server-cache";
import { openSessionYmd } from "@/lib/meridian/meridian-open-session";
import {
  reactionsForDates,
  reactionsForPrints,
  barLimitForWindow,
  type DailyBarLike,
  type PrintReaction,
  type PrintTiming,
  type SessionReaction,
} from "@/lib/meridian/meridian-reaction-core";

const REACTION_CACHE_MS = 30 * 60 * 1000;

async function loadIndexBars(from: string, to: string): Promise<DailyBarLike[]> {
  // Same window-derived limit as the stock path. 400 happened to cover the macro windows in
  // use today, but it is the identical latent bug: a fixed cap under a variable window
  // truncates from the far end the moment someone asks for a longer history.
  const limit = barLimitForWindow(from, to);
  return serverCache(`meridian:bars:I:SPX:${from}:${to}:l${limit}`, REACTION_CACHE_MS, () =>
    fetchIndexDailyBars("I:SPX", from, to, String(limit)).catch(() => [])
  );
}


async function loadStockBars(ticker: string, from: string, to: string): Promise<DailyBarLike[]> {
  const sym = ticker.toUpperCase();
  const limit = barLimitForWindow(from, to);
  return serverCache(`meridian:bars:${sym}:${from}:${to}:l${limit}`, REACTION_CACHE_MS, () =>
    fetchStockDailyBars(sym, from, to, String(limit)).catch(() => [])
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

/**
 * Earnings-print reactions, anchored to the session that could actually trade the news
 * (see `reactionForPrint`). Distinct from `stockReactionsForDates` because only earnings
 * carry a BMO/AMC timestamp — an FDA decision has no equivalent bell-relative semantics,
 * so that path keeps the plain report-date reading rather than inheriting an assumption
 * that does not apply to it.
 *
 * The AMC case needs one session BEYOND the newest print, so the window runs to today —
 * which `barWindowForDates` already does.
 */
export async function stockReactionsForPrints(
  ticker: string,
  prints: Array<{ ymd: string; timing: PrintTiming }>
): Promise<Map<string, PrintReaction>> {
  if (!prints.length || !ticker.trim()) return new Map();
  const { from, to } = barWindowForDates(prints.map((p) => p.ymd));
  const bars = await loadStockBars(ticker, from, to);
  // Tell the core whether the anchor session is still running, so a print from THIS session is
  // labelled as still moving rather than as a measurement.
  return reactionsForPrints(bars, prints, openSessionYmd());
}
