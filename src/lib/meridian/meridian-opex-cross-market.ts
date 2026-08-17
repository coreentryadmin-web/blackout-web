import "server-only";

import { priorOpexDates } from "@/features/meridian/lib/meridian-timeline";
import {
  buildMeridianOpexCrossMarket,
  MERIDIAN_OPEX_BENCHMARKS,
  MERIDIAN_OPEX_MAG7,
  rankOpexSessionMovers,
} from "@/lib/meridian/meridian-opex-cross-market-core";
import { spxReactionsForDates, stockReactionsForDates } from "@/lib/meridian/meridian-reaction";
import { fetchDailyMarketSummary } from "@/lib/providers/polygon";
import { serverCache } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";
import type { MeridianOpexCrossMarket } from "@/features/meridian/lib/meridian-types";

const OPEX_CROSS_CACHE_MS = 30 * 60 * 1000;

async function groupedDailyForDate(date: string) {
  return serverCache(`meridian:opex:grouped:${date}`, OPEX_CROSS_CACHE_MS, () =>
    fetchDailyMarketSummary(date)
      .then((data) => data.results ?? [])
      .catch(() => [])
  );
}

/** SPX / benchmarks / Mag7 / top movers across prior monthly OpEx sessions. */
export async function loadMeridianOpexCrossMarket(beforeYmd: string): Promise<MeridianOpexCrossMarket> {
  const dates = priorOpexDates(beforeYmd, 6);
  if (!dates.length) {
    return buildMeridianOpexCrossMarket({
      dates: [],
      spx: new Map(),
      spy: new Map(),
      qqq: new Map(),
      iwm: new Map(),
      mag7ByTicker: new Map(),
      moversByDate: new Map(),
    });
  }

  const [spx, spy, qqq, iwm, groupedRows, ...mag7Maps] = await Promise.all([
    spxReactionsForDates(dates),
    stockReactionsForDates("SPY", dates),
    stockReactionsForDates("QQQ", dates),
    stockReactionsForDates("IWM", dates),
    Promise.all(dates.map((d) => groupedDailyForDate(d))),
    ...MERIDIAN_OPEX_MAG7.map((ticker) => stockReactionsForDates(ticker, dates)),
  ]);

  const mag7ByTicker = new Map<string, Awaited<ReturnType<typeof stockReactionsForDates>>>();
  MERIDIAN_OPEX_MAG7.forEach((ticker, i) => {
    mag7ByTicker.set(ticker, mag7Maps[i] as Awaited<ReturnType<typeof stockReactionsForDates>>);
  });

  const moversByDate = new Map<
    string,
    ReturnType<typeof rankOpexSessionMovers>
  >();
  dates.forEach((date, i) => {
    moversByDate.set(date, rankOpexSessionMovers(groupedRows[i] ?? []));
  });

  return roundFloats(
    buildMeridianOpexCrossMarket({
      dates,
      spx,
      spy,
      qqq,
      iwm,
      mag7ByTicker,
      moversByDate,
    })
  );
}

/** Benchmark tickers surfaced in the cross-market panel (for tests / docs). */
export const meridianOpexBenchmarkTickers = MERIDIAN_OPEX_BENCHMARKS;
