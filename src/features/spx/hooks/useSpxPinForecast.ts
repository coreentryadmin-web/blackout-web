"use client";

import useSWR from "swr";
import { fetchSpxPin } from "@/lib/api";
import { todayEtYmdClient } from "@/lib/session-cache";
import { SPX_PIN_POLL_MS } from "@/features/spx/lib/spx-desk-poll-ms";
// Type-only import — erased at compile, so the server-only spx-pin module never enters the client bundle.
import type { SpxPinForecast } from "@/features/spx/lib/spx-pin";

/** Live EOD Pin Forecaster feed. Polls /api/market/spx/pin every 5s during RTH; idle off-session. */
export function useSpxPinForecast(sessionActive = true) {
  const sessionDate = todayEtYmdClient();
  const { data, isValidating, isLoading } = useSWR<SpxPinForecast>(
    sessionActive ? `spx-pin:${sessionDate}` : null,
    fetchSpxPin,
    {
      refreshInterval: sessionActive ? SPX_PIN_POLL_MS : 0,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: Math.max(800, SPX_PIN_POLL_MS - 500),
    }
  );

  return {
    pin: data ?? null,
    pinLoading: sessionActive && isLoading && !data,
    pinRefreshing: sessionActive && isValidating && Boolean(data),
  };
}
