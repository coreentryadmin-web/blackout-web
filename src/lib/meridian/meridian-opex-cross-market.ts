import "server-only";

import { priorOpexDates } from "@/features/meridian/lib/meridian-timeline";
import {
  buildMeridianOpexCrossMarket,
  MERIDIAN_OPEX_MAG7,
  rankOpexSessionMovers,
} from "@/lib/meridian/meridian-opex-cross-market-core";
import { spxReactionsForDates, stockReactionsForDates } from "@/lib/meridian/meridian-reaction";
import { fetchDailyMarketSummary } from "@/lib/providers/polygon";
import { serverCache } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";
import { loadOpexGroupedDailyOrEmpty } from "@/lib/meridian/meridian-opex-grouped-daily";
import type { MeridianOpexCrossMarket } from "@/features/meridian/lib/meridian-types";

const OPEX_CROSS_CACHE_MS = 30 * 60 * 1000;

async function groupedDailyForDate(date: string) {
  // BUG FIX: the `.catch(() => [])` used to live INSIDE the loader passed to `serverCache`, so a
  // real Polygon grouped-daily failure never reached the cache as a rejection — it got written
  // in as a successful "no movers" result for the full 30-minute TTL. See
  // `meridian-opex-grouped-daily.ts`'s header for the full root-cause writeup (same bug class as
  // `meridian-peer-reactions.ts`/`dossier.ts`'s prior fixes in this file's history). The catch now
  // lives OUTSIDE `serverCache` (inside the extracted, unit-tested `loadOpexGroupedDailyOrEmpty`),
  // so a failure propagates through the cache untouched and is never frozen into it.
  return loadOpexGroupedDailyOrEmpty(
    serverCache,
    `meridian:opex:grouped:${date}`,
    OPEX_CROSS_CACHE_MS,
    () => fetchDailyMarketSummary(date).then((data) => data.results ?? [])
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
