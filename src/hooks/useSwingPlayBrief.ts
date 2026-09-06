"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  diffBriefSnapshots,
  envelopeWithDiffSection,
  snapshotFromBrief,
  type BriefSnapshot,
} from "@/lib/swing/play-brief-diff";

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
  const posTail = play.id.match(/^SWING:[^:]+:(\d+)$/i);
  if (posTail) params.set("positionId", posTail[1]!);
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

function extrasFromEnvelope(envelope: BieAnswerEnvelope) {
  const levels = envelope.levels ?? [];
  const price = (substr: string) =>
    levels.find((l) => l.label.toLowerCase().includes(substr))?.price ?? null;
  return {
    spot: price("spot"),
    gammaFlip: price("gamma flip"),
    callWall: price("call wall"),
    putWall: price("put wall"),
  };
}

function playLiveSig(play: TerminalPlay | null): string {
  if (!play) return "";
  return [
    play.mark,
    play.pnlPct,
    play.recommendation,
    play.thesisHealth?.health,
    play.peak,
    play.status,
  ].join("|");
}

export function useSwingPlayBrief(play: TerminalPlay | null) {
  const key = play ? briefUrl(play) : null;
  const prevSnapRef = useRef<BriefSnapshot | null>(null);
  const prevPlayIdRef = useRef<string | null>(null);
  const prevLiveSigRef = useRef("");

  const { data, error, isLoading, mutate } = useSWR<SwingPlayBriefResponse>(key, json, {
    refreshInterval: briefRefreshMs(),
    revalidateOnFocus: true,
    dedupingInterval: 3_000,
  });

  const [envelope, setEnvelope] = useState<BieAnswerEnvelope | null>(null);
  const [changeCount, setChangeCount] = useState(0);

  useEffect(() => {
    if (play?.id !== prevPlayIdRef.current) {
      prevSnapRef.current = null;
      prevPlayIdRef.current = play?.id ?? null;
      prevLiveSigRef.current = "";
      setChangeCount(0);
    }
  }, [play?.id]);

  const liveSig = playLiveSig(play);
  useEffect(() => {
    if (!key || !liveSig || liveSig === prevLiveSigRef.current) return;
    prevLiveSigRef.current = liveSig;
    void mutate();
  }, [key, liveSig, mutate]);

  useEffect(() => {
    const raw = data?.envelope;
    if (!raw) {
      setEnvelope(null);
      return;
    }
    if (!play) {
      setEnvelope(raw);
      return;
    }
    const extras = extrasFromEnvelope(raw);
    const nextSnap = snapshotFromBrief(raw, play, extras);
    const changes = diffBriefSnapshots(prevSnapRef.current, nextSnap);
    prevSnapRef.current = nextSnap;
    setChangeCount(changes.length);
    setEnvelope(changes.length ? envelopeWithDiffSection(raw, changes) : raw);
  }, [data?.envelope, play, liveSig]);

  const refresh = useCallback(() => mutate(), [mutate]);

  return {
    brief: data?.available ? data : null,
    envelope,
    asOf: data?.asOf ?? data?.envelope?.asOf ?? null,
    loading: Boolean(key) && isLoading && !data,
    error: error ?? (data?.degraded ? new Error("brief degraded") : null),
    refresh,
    changeCount,
  };
}
