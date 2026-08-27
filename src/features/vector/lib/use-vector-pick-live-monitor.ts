"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchVectorPickLiveQuotes,
  type VectorContractPick,
} from "@/lib/api";
import type { VectorPlayEmit } from "./vector-play-engine";

const LIVE_POLL_MS = 1_000;
// Same threshold VectorPageShell already uses for the chart's own candle staleness
// (CANDLE_STALE_MS) — 10x the poll cadence, so one or two missed ticks (a blip, not an outage)
// don't flip the badge, but a genuinely stuck feed does within a few seconds.
export const LIVE_QUOTES_STALE_MS = 10_000;

/**
 * Pure decision, split out from the hook so it's unit-testable without a React rendering harness
 * (this repo has none — see use-vector-pick-live-monitor.test.ts). `lastSuccessAtMs === null` means
 * "never had a successful read yet," which is deliberately NOT stale — there's no live value being
 * misrepresented as fresh when none has ever arrived.
 */
export function isLiveQuotesStale(
  lastSuccessAtMs: number | null,
  nowMs: number,
  staleAfterMs: number = LIVE_QUOTES_STALE_MS
): boolean {
  return lastSuccessAtMs != null && nowMs - lastSuccessAtMs > staleAfterMs;
}

/**
 * Merges ~1s live option quotes + Still Buy / Don't Buy status onto ranked picks.
 *
 * RESILIENCE NOTE (2026-08-27): the poll's on-failure fallback (keep the last good live read) is
 * correct — a transient failure shouldn't blank out a member's still-valid last quote — but on
 * repeated failure it used to mean `liveByOcc` simply never updated again, with no signal
 * distinguishing "live" from "frozen 10 minutes ago." `pollTick` forces a re-render every poll
 * cycle regardless of success/failure so `liveQuotesStale` (derived from wall-clock time since the
 * last SUCCESSFUL read) stays accurate even while every read is failing — the same class of bug as
 * the Compare-mode SSE singleton fixed alongside this: a frozen value presented with no indication
 * it stopped updating.
 */
export function useVectorPickLiveMonitor(
  ticker: string,
  emit: VectorPlayEmit | null,
  picks: VectorContractPick[],
  liveSession: boolean
): VectorContractPick[] {
  const [liveByOcc, setLiveByOcc] = useState<
    Record<
      string,
      {
        bid: number | null;
        ask: number | null;
        mid: number | null;
        delta: number | null;
        gamma: number | null;
        theta: number | null;
        iv: number | null;
        actionStatus: "still_buy" | "caution" | "dont_buy";
        actionReason: string;
        premiumPctFromEntry: number | null;
        setupInvalidated: boolean;
      }
    >
  >({});

  const pickKey = picks.map((p) => `${p.occ}|${p.entryMid}|${p.strike}`).join(";");
  const genRef = useRef(0);
  // Wall-clock time of the last SUCCESSFUL poll — not reset on failure, so it keeps growing stale
  // across an outage instead of resetting on every failed attempt.
  const lastSuccessAtRef = useRef<number | null>(null);
  // Bumped on every poll tick regardless of success/failure, purely to force a re-render so
  // `liveQuotesStale` (computed from `Date.now() - lastSuccessAtRef.current` below) stays accurate
  // even during a run of failures where `liveByOcc` itself never changes.
  const [pollTick, setPollTick] = useState(0);

  useEffect(() => {
    if (!emit?.play || picks.length === 0 || !liveSession) {
      setLiveByOcc({});
      lastSuccessAtRef.current = null;
      return;
    }
    const occPicks = picks.filter((p): p is VectorContractPick & { occ: string } => Boolean(p.occ));
    if (!occPicks.length) return;

    let cancelled = false;
    const gen = ++genRef.current;

    const poll = () => {
      fetchVectorPickLiveQuotes({
        ticker,
        spot: emit.spot,
        play: emit.play,
        callWall: emit.callWall,
        putWall: emit.putWall,
        gammaFlip: emit.gammaFlip,
        picks: occPicks.map((p) => ({
          occ: p.occ!,
          side: p.side,
          strike: p.strike,
          expiry: p.expiry,
          entryMid: p.entryMid ?? p.premium,
          caveat: p.caveat,
        })),
      })
        .then((res) => {
          if (cancelled || genRef.current !== gen) return;
          const next: typeof liveByOcc = {};
          for (const row of res.live ?? []) {
            next[row.occ] = {
              bid: row.bid,
              ask: row.ask,
              mid: row.mid,
              delta: row.delta,
              gamma: row.gamma,
              theta: row.theta,
              iv: row.iv,
              actionStatus: row.actionStatus,
              actionReason: row.actionReason,
              premiumPctFromEntry: row.premiumPctFromEntry,
              setupInvalidated: row.setupInvalidated,
            };
          }
          lastSuccessAtRef.current = Date.now();
          setLiveByOcc(next);
        })
        .catch(() => {
          /* keep last good live read */
        })
        .finally(() => {
          if (cancelled || genRef.current !== gen) return;
          // Forces a re-render every poll cycle (success or failure) so `liveQuotesStale` below
          // stays accurate during a run of failures where `liveByOcc` itself never changes.
          setPollTick((t) => t + 1);
        });
    };

    poll();
    const id = setInterval(poll, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ticker, emit, pickKey, picks, liveSession]);

  return useMemo(() => {
    const stale = isLiveQuotesStale(lastSuccessAtRef.current, Date.now());
    return picks.map((pick) => {
      const live = pick.occ ? liveByOcc[pick.occ] : undefined;
      if (!live) return pick;
      return {
        ...pick,
        liveBid: live.bid,
        liveAsk: live.ask,
        liveMid: live.mid,
        liveDelta: live.delta,
        liveGamma: live.gamma,
        liveTheta: live.theta,
        liveIv: live.iv,
        actionStatus: live.actionStatus,
        actionReason: live.actionReason,
        premiumPctFromEntry: live.premiumPctFromEntry,
        setupInvalidated: live.setupInvalidated,
        liveQuotesStale: stale,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pollTick has no direct use in the
    // body; it exists purely to force this memo to recompute `stale` on every poll cycle.
  }, [picks, liveByOcc, pollTick]);
}
