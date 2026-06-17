"use client";

import useSWR from "swr";
import { fetchSpxLottoToday } from "@/lib/api";

const LOTTO_PREMARKET_MS = 60_000;
const LOTTO_OPEN_MS = 10_000;

function lottoPollMs(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return 0;
  const mins = hour * 60 + minute;
  if (mins >= 7 * 60 && mins < 10 * 60 + 30) {
    return mins < 9 * 60 + 30 ? LOTTO_PREMARKET_MS : LOTTO_OPEN_MS;
  }
  return 0;
}

export function useSpxLotto(sessionActive = true) {
  const interval = sessionActive ? lottoPollMs() : 0;
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
  };
}
