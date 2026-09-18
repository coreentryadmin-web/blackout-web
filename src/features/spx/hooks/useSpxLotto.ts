"use client";

import useSWR from "swr";
import { useEffect } from "react";
import { fetchSpxLottoToday } from "@/lib/api";
import { isLottoPollWindow } from "@/features/spx/lib/spx-play-session-guards";
import { SPX_LOTTO_OPEN_POLL_MS, SPX_LOTTO_PREMARKET_POLL_MS } from "@/features/spx/lib/spx-desk-poll-ms";

const LOTTO_PREMARKET_MS = SPX_LOTTO_PREMARKET_POLL_MS;
const LOTTO_OPEN_MS = SPX_LOTTO_OPEN_POLL_MS;

/** Poll interval during the lotto poll window; 0 outside it (still fetches once on mount). */
export function lottoPollIntervalMs(): number {
  if (!isLottoPollWindow()) return 0;
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

/**
 * Milliseconds from `now` until 9:30 AM ET cash open (negative/zero once past open).
 * `hour12: false` renders ET midnight as hour "24" in some Node/ICU builds, not "00" (the
 * same quirk fixed in session.ts's etNowParts, #4703, and its documented follow-up sweep) —
 * unlike this file's own `lottoPollIntervalMs`, which is gated behind `isLottoPollWindow()`
 * (7 AM-2 PM ET, so its identical unnormalized arithmetic never actually runs at midnight),
 * this computation had NO time-of-day gate at all: any mount during the 00:00-00:59 ET hour
 * read `h` as 24, producing `etSecondsNow` ~86400s too high and `msUntilOpen` deeply negative
 * — silently skipping the scheduled cash-open refresh for that mount instead of firing it.
 */
export function msUntilSpxCashOpenEt(now = new Date()): number {
  const nyParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = Number(nyParts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(nyParts.find((p) => p.type === "minute")?.value ?? 0);
  const s = Number(nyParts.find((p) => p.type === "second")?.value ?? 0);
  const etSecondsNow = h * 3600 + m * 60 + s;
  const cashOpenSeconds = 9 * 3600 + 30 * 60;
  return (cashOpenSeconds - etSecondsNow) * 1000;
}

/** Lotto track polls independently of main desk session — 7:00 AM–2:00 PM ET (engine intraday cutoff). */
export function useSpxLotto() {
  const interval = lottoPollIntervalMs();
  const { data, isValidating, isLoading, mutate } = useSWR("spx-lotto-today", fetchSpxLottoToday, {
    refreshInterval: interval,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    // H-2: revalidateOnFocus so a tab focus after 10:30 refreshes the final expired state
    // rather than showing stale data indefinitely (interval=0 after window closes).
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 5_000,
  });

  // H-1: Schedule an immediate mutate() at 9:30 ET cash open so the interval dynamically
  // switches from 60s (premarket) to 10s (open) without waiting for the next render cycle.
  useEffect(() => {
    const msUntilOpen = msUntilSpxCashOpenEt();
    if (msUntilOpen <= 0) return; // already past cash open
    const timer = setTimeout(() => {
      void mutate();
    }, msUntilOpen);
    return () => clearTimeout(timer);
  }, [mutate]);

  return {
    lotto: data?.lotto ?? null,
    lottoHistory: data?.history ?? [],
    lottoLoading: isLoading && !data,
    lottoRefreshing: isValidating && Boolean(data),
    lottoWindowActive: isLottoPollWindow(),
  };
}
