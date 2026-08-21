import "server-only";

import { fetchIndexDailyBars, fetchIndexMinuteBars, fetchStockMinuteBars } from "@/lib/providers/polygon";
import { flowPriceSymbol } from "@/lib/providers/flow-price-symbol";
import { intradayReactionFromBars } from "@/lib/meridian/meridian-intraday-core";
import type { IntradayReaction } from "@/lib/meridian/meridian-intraday-core";

// WHY EVERY POLYGON AGGREGATES CALL IN THIS FILE GOES THROUGH `flowPriceSymbol`:
//
// Polygon lists indices under an `I:` namespace, and the EQUITY namespace does not ERROR for an
// index root — it returns a silent empty success. Probed live 2026-08-21 on both Massive and
// Polygon:
//
//   /v2/aggs/ticker/SPX/range/1/day/2026-08-19/2026-08-19    -> 200 OK, resultsCount 0
//   /v2/aggs/ticker/I:SPX/range/1/day/2026-08-19/2026-08-19  -> 200 OK, 1 bar (c 7707.98)
//   /v2/aggs/ticker/SPX/range/1/minute/2026-08-19/…          -> 200 OK, resultsCount 0
//   /v2/aggs/ticker/I:SPX/range/1/minute/2026-08-19/…        -> 200 OK, 396 bars
//
// This file passed the bare string "SPX" to both, so nothing threw, nothing logged, and every
// caller just got `[]` and concluded the value was unknown — on every retry, forever.
//
// `flowPriceSymbol` is the repo's one index-symbol map whose every entry was verified against
// live bars rather than inferred from the naming pattern (it passes `I:`-prefixed input through
// untouched, and lets an unknown symbol fall through to the equity path rather than guessing an
// `I:` form for it). Reusing it keeps ONE derivation rather than seeding a second, divergent copy.


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

  // `useIndex: false` still forces the equity path (a caller pricing SPY, say); the map only
  // decides WHICH symbol an index request must use, it never overrides an explicit opt-out.
  const resolved = flowPriceSymbol(sym);
  const useIndexPath = input.useIndex !== false && resolved?.isIndex === true;
  const fetchBars = useIndexPath ? fetchIndexMinuteBars : fetchStockMinuteBars;
  const polygonSymbol = useIndexPath ? resolved!.symbol : sym;

  const bars = await fetchBars(polygonSymbol, input.date, input.date).catch(() => []);
  const reaction = intradayReactionFromBars(bars, input.releaseTimeEt);
  // Only memoize a REAL read. `intradayReactionFromBars([])` is all-nulls, and this cache lives
  // for the life of the process — so caching it turns one empty fetch (an upstream blip, a
  // rate-limit, or the bug above) into a permanent "this session has no reaction". The whole
  // defect this file was carrying is a silent empty success being taken for an answer; storing
  // that answer would preserve the same mistake past the fix.
  if (reaction.release_price != null) INTRADAY_CACHE.set(key, reaction);
  return reaction;
}

/** SPX close on an ET date from daily bars. */
export async function spxCloseOnDate(date: string): Promise<number | null> {
  // "SPX" here priced NOTHING — see the namespace note at the top of this file. Every caller
  // (meridian-opex-history's `spx_close`, and `pin_held` downstream of it) has been null since
  // this was written.
  const symbol = flowPriceSymbol("SPX")?.symbol ?? "I:SPX";
  const bars = await fetchIndexDailyBars(symbol, date, date).catch(() => []);
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
