"use client";

import useSWR from "swr";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";

export type SwingPlayBriefResponse = {
  available: boolean;
  playId?: string;
  ticker?: string;
  envelope?: BieAnswerEnvelope;
  asOf?: string;
  engine?: "swing_play_intelligence";
  degraded?: boolean;
  error?: string;
};

const json = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" }).then((r) =>
    r.ok ? r.json() : ({ available: false, degraded: true } as SwingPlayBriefResponse),
  );

function briefUrl(play: TerminalPlay): string | null {
  if (!play?.id || !play.ticker) return null;
  const params = new URLSearchParams({
    playId: play.id,
    ticker: play.ticker,
  });
  if (play.status) params.set("status", play.status);
  const m = play.contract.match(/^(\d+(?:\.\d+)?)([CP])/);
  if (m) {
    params.set("strike", m[1]!);
    params.set("right", m[2]!);
  }
  return `/api/market/swing/play-brief?${params.toString()}`;
}

/** Live refresh cadence — faster during RTH when marks move. */
function briefRefreshMs(): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    if (weekday === "Sat" || weekday === "Sun") return 20_000;
    const mins = hour * 60 + minute;
    if (mins >= 9 * 60 + 25 && mins <= 16 * 60 + 5) return 8_000;
  } catch {
    /* fall through */
  }
  return 20_000;
}

export function useSwingPlayBrief(play: TerminalPlay | null) {
  const key = play ? briefUrl(play) : null;

  const { data, error, isLoading, mutate } = useSWR<SwingPlayBriefResponse>(key, json, {
    refreshInterval: briefRefreshMs(),
    revalidateOnFocus: true,
    dedupingInterval: 3_000,
  });

  return {
    brief: data?.available ? data : null,
    envelope: data?.envelope ?? null,
    asOf: data?.asOf ?? null,
    loading: Boolean(key) && isLoading && !data,
    error: error ?? (data?.degraded ? new Error("brief degraded") : null),
    refresh: mutate,
  };
}
