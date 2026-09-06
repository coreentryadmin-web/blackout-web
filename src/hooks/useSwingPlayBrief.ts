"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  diffBriefSnapshots,
  envelopeWithNarrativePulse,
  extrasFromBriefResponse,
  snapshotFromBrief,
  type BriefSnapshot,
} from "@/lib/swing/play-brief-diff";
import { useZeroDteLiveMarks } from "@/features/nighthawk/command-deck/use-live-marks";

export type SwingPlayBriefResponse = {
  available: boolean;
  playId?: string;
  ticker?: string;
  envelope?: BieAnswerEnvelope;
  asOf?: string;
  engine?: "swing_play_intelligence";
  flowSnapshot?: { callPremium: number | null; putPremium: number | null } | null;
  briefContentKey?: string;
  trimsFired?: number | null;
  degraded?: boolean;
  error?: string;
};

export type UseSwingPlayBriefOptions = {
  /** Request uncollapsed intel sections (GEX, Flow, Hold plan, etc.). */
  expandIntel?: boolean;
};

const json = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" }).then((r) =>
    r.ok ? r.json() : ({ available: false, degraded: true } as SwingPlayBriefResponse),
  );

function briefUrl(play: TerminalPlay, expandIntel: boolean): string | null {
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
  if (expandIntel) params.set("expandIntel", "1");
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

function trimSig(play: TerminalPlay | null): string {
  if (!play?.exitPolicy?.trim_levels?.length) return "";
  return play.exitPolicy.trim_levels.map((t) => `${t.trigger_pct}:${t.fired ? 1 : 0}`).join(",");
}

function playLiveSig(play: TerminalPlay | null): string {
  if (!play) return "";
  return [
    play.mark,
    play.pnlPct,
    play.execPnlPct,
    play.recommendation,
    play.thesisHealth?.health,
    play.peak,
    play.status,
    play.manageAction,
    play.progress,
    trimSig(play),
  ].join("|");
}

export function useSwingPlayBrief(play: TerminalPlay | null, opts?: UseSwingPlayBriefOptions) {
  const expandIntel = opts?.expandIntel ?? false;
  const key = play ? briefUrl(play, expandIntel) : null;
  const liveMarks = useZeroDteLiveMarks(Boolean(play?.occ));
  const marksBriefSig = useMemo(() => {
    if (!play?.occ) return "";
    return liveMarks.get(play.occ)?.brief_sig ?? "";
  }, [play?.occ, liveMarks]);

  const prevSnapRef = useRef<BriefSnapshot | null>(null);
  const prevPlayIdRef = useRef<string | null>(null);
  const prevLiveSigRef = useRef("");
  const prevMarksBriefSigRef = useRef("");

  const { data, error, isLoading, isValidating, mutate } = useSWR<SwingPlayBriefResponse>(key, json, {
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
      prevMarksBriefSigRef.current = "";
      setChangeCount(0);
    }
  }, [play?.id]);

  const liveSig = playLiveSig(play);
  useEffect(() => {
    if (!key || !liveSig || liveSig === prevLiveSigRef.current) return;
    prevLiveSigRef.current = liveSig;
    void mutate();
  }, [key, liveSig, mutate]);

  /** Marks SSE ~1s lane — server-authoritative refresh when mark/P&L/status moves. */
  useEffect(() => {
    if (!key || !marksBriefSig || marksBriefSig === prevMarksBriefSigRef.current) return;
    prevMarksBriefSigRef.current = marksBriefSig;
    void mutate();
  }, [key, marksBriefSig, mutate]);

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

    const extras = extrasFromBriefResponse(data ?? {});
    const nextSnap = snapshotFromBrief(raw, play, extras);
    const changes = diffBriefSnapshots(prevSnapRef.current, nextSnap);
    prevSnapRef.current = nextSnap;
    setChangeCount(changes.length);
    setEnvelope(changes.length ? envelopeWithNarrativePulse(raw, changes) : raw);
  }, [data, play, liveSig]);

  const refresh = useCallback(() => mutate(), [mutate]);

  return {
    brief: data?.available ? data : null,
    envelope,
    asOf: data?.envelope?.asOf ?? data?.asOf ?? null,
    loading: Boolean(key) && isLoading && !data,
    error: error ?? (data?.degraded ? new Error("brief degraded") : null),
    refresh,
    changeCount,
    isLiveRefreshing: isValidating && Boolean(data),
    briefContentKey: data?.briefContentKey ?? null,
  };
}
