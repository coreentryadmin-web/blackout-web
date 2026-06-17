"use client";

import useSWR from "swr";
import { fetchSpxLottoToday } from "@/lib/api";
import { isLottoWindow } from "@/lib/spx-play-session-guards";

const LOTTO_PREMARKET_MS = 60_000;
const LOTTO_OPEN_MS = 10_000;

/** Poll interval during the lotto window; 0 outside it (still fetches once on mount). */
export function lottoPollIntervalMs(): number {
  if (!isLottoWindow()) return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  return mins < 9 * 60 + 30 ? LOTTO_PREMARKET_MS : LOTTO_OPEN_MS;
}

/** Lotto track polls independently of main desk session — 7:00–10:30 AM ET only. */
export function useSpxLotto() {
  const interval = lottoPollIntervalMs();
  const { data, isValidating, isLoading } = useSWR("spx-lotto-today", fetchSpxLottoToday, {
    refreshInterval: interval,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 5_000,
  });

  return {
    lotto: data?.lotto ?? null,
    lottoHistory: data?.history ?? [],
    lottoLoading: isLoading && !data,
    lottoRefreshing: isValidating && Boolean(data),
    lottoWindowActive: isLottoWindow(),
  };
}
