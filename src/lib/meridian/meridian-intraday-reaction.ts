import "server-only";

import { fetchIndexDailyBars, fetchIndexMinuteBars, fetchStockMinuteBars } from "@/lib/providers/polygon";
import { intradayReactionFromBars } from "@/lib/meridian/meridian-intraday-core";
import type { IntradayReaction } from "@/lib/meridian/meridian-intraday-core";

const INTRADAY_CACHE = new Map<string, IntradayReaction>();

function cacheKey(symbol: string, date: string, time: string): string {
  return `${symbol}:${date}:${time}`;
}

/** Cached intraday reaction for one ET session + release time. */
export async function loadIntradayReaction(input: {
  symbol: string;
  date: string;
  releaseTimeEt: string;
  useIndex?: boolean;
}): Promise<IntradayReaction> {
  const sym = input.symbol.toUpperCase();
  const key = cacheKey(sym, input.date, input.releaseTimeEt);
  const hit = INTRADAY_CACHE.get(key);
  if (hit) return hit;

  const fetchBars = input.useIndex !== false && /^(SPX|VIX|NDX|RUT)$/.test(sym)
    ? fetchIndexMinuteBars
    : fetchStockMinuteBars;

  const bars = await fetchBars(sym, input.date, input.date).catch(() => []);
  const reaction = intradayReactionFromBars(bars, input.releaseTimeEt);
  INTRADAY_CACHE.set(key, reaction);
  return reaction;
}

/** SPX close on an ET date from daily bars. */
export async function spxCloseOnDate(date: string): Promise<number | null> {
  const bars = await fetchIndexDailyBars("SPX", date, date).catch(() => []);
  const bar = bars[bars.length - 1];
  return bar && Number.isFinite(bar.c) ? bar.c : null;
}

/** Batch intraday 60m reactions for macro history dates. */
export async function macroIntradayReactions(
  dates: string[],
  releaseTimeEt: string | null
): Promise<Map<string, number | null>> {
  const time = releaseTimeEt ?? "08:30";
  const out = new Map<string, number | null>();
  await Promise.all(
    dates.map(async (date) => {
      const rx = await loadIntradayReaction({
        symbol: "SPX",
        date,
        releaseTimeEt: time,
        useIndex: true,
      });
      out.set(date, rx.move_pct_60);
    })
  );
  return out;
}
