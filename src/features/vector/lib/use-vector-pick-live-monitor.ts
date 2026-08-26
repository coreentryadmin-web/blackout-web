"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchVectorPickLiveQuotes,
  type VectorContractPick,
} from "@/lib/api";
import type { VectorPlayEmit } from "./vector-play-engine";

const LIVE_POLL_MS = 1_000;

/**
 * Merges ~1s live option quotes + Still Buy / Don't Buy status onto ranked picks.
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

  useEffect(() => {
    if (!emit?.play || picks.length === 0 || !liveSession) {
      setLiveByOcc({});
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
          setLiveByOcc(next);
        })
        .catch(() => {
          /* keep last good live read */
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
      };
    });
  }, [picks, liveByOcc]);
}
