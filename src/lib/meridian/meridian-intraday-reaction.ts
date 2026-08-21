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


/**
 * Cached intraday reactions, with an expiry per entry.
 *
 * A REAL read is stable forever — a past session's minute bars do not change — so it is cached
 * without expiry. An EMPTY read is cached only briefly, and that asymmetry matters more than it
 * looks: SPX index minute bars begin at 09:30 ET (verified live 2026-08-19 — 396 bars, 09:30 to
 * 16:05, ZERO in the 08:20-08:40 window), while `eventReleaseTime` returns "08:30" for every
 * macro event except the FOMC family. So every 08:30 release is PERMANENTLY dataless at its own
 * release time. Never caching those would re-issue a `limit=5000` minute-bar fetch per date on
 * every single request; caching them forever would freeze a genuine outage into a permanent
 * "no reaction". A short TTL is the only reading that is honest about both.
 */
const INTRADAY_TTL_MS = { measured: Number.POSITIVE_INFINITY, empty: 10 * 60 * 1000 };
const INTRADAY_CACHE = new Map<string, { value: IntradayReaction; expiresAt: number }>();

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
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  // `useIndex: false` still forces the equity path (a caller pricing SPY, say); the map only
  // decides WHICH symbol an index request must use, it never overrides an explicit opt-out.
  const resolved = flowPriceSymbol(sym);
  const useIndexPath = input.useIndex !== false && resolved?.isIndex === true;
  const fetchBars = useIndexPath ? fetchIndexMinuteBars : fetchStockMinuteBars;
  const polygonSymbol = useIndexPath ? resolved!.symbol : sym;

  const bars = await fetchBars(polygonSymbol, input.date, input.date).catch(() => []);
  const reaction = intradayReactionFromBars(bars, input.releaseTimeEt);
  // A measured read is permanent; an empty one is provisional. Caching an empty read FOREVER
  // would turn one upstream blip into a permanent "this session has no reaction" — the same
  // silent-empty-success mistake this file already carried once. Not caching it at all would
  // re-fetch 5000 minute bars per date per request for the 08:30 macro cohort, which has no
  // bars at its release time by construction (see the note on INTRADAY_TTL_MS).
  const ttl = reaction.release_price != null ? INTRADAY_TTL_MS.measured : INTRADAY_TTL_MS.empty;
  INTRADAY_CACHE.set(key, { value: reaction, expiresAt: Date.now() + ttl });
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
