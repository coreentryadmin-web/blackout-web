"use client";

import { useEffect, useRef, useState } from "react";
import { fetchVectorContractPicks, type VectorContractPick } from "@/lib/api";
import type { VectorPlayEmit } from "./vector-play-engine";
import type { FlowAlert } from "@/lib/api";

const REFRESH_MS = 45_000;
const DEBOUNCE_MS = 500;

/**
 * Fetches ranked contract picks (1–3) for the current play context. POSTs full walls/spot/flow
 * so each pick is scored independently across DTE windows — not cloned conviction on both legs.
 */
export function useVectorContractPicks(
  ticker: string,
  emit: VectorPlayEmit | null,
  sessionFlows: readonly FlowAlert[],
  liveSession: boolean,
  paused = false,
  excludeOccs: readonly string[] = []
): { picks: VectorContractPick[]; loading: boolean } {
  const [picks, setPicks] = useState<VectorContractPick[]>([]);
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const play = emit?.play ?? null;
  const bias = play?.bias ?? null;
  const contextKey = emit
    ? `${emit.spot}|${emit.callWall}|${emit.putWall}|${play?.conviction}|${play?.headline}|${sessionFlows.length}|${excludeOccs.join(",")}`
    : "";

  useEffect(() => {
    if (paused) {
      setLoading(false);
      return;
    }
    if (!emit || !play || !bias || bias === "neutral") {
      setPicks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const gen = ++genRef.current;

    const load = () => {
      setLoading(true);
      fetchVectorContractPicks({
        ticker,
        play,
        spot: emit.spot,
        callWall: emit.callWall,
        putWall: emit.putWall,
        magnetStrike: emit.magnetStrike,
        gammaFlip: emit.gammaFlip,
        regimePosture: emit.regimePosture,
        technicals: emit.technicals,
        confluenceZones: emit.confluenceZones?.map((z) => ({
          center: z.center,
          score: z.score,
          kinds: z.kinds,
        })),
        darkPoolLevels: emit.darkPoolLevels,
        excludeOccs: excludeOccs.length ? [...excludeOccs] : undefined,
        flows: sessionFlows.map((f) => ({
          option_type: f.option_type,
          premium: f.premium,
          strike: f.strike,
          expiry: f.expiry,
        })),
      })
        .then((res) => {
          if (cancelled || genRef.current !== gen) return;
          setPicks(res.pool?.length ? res.pool : (res.picks ?? []));
        })
        .catch(() => {
          if (cancelled || genRef.current !== gen) return;
          setPicks([]);
        })
        .finally(() => {
          if (cancelled || genRef.current !== gen) return;
          setLoading(false);
        });
    };

    const debounce = setTimeout(load, DEBOUNCE_MS);
    const interval = liveSession ? setInterval(load, REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      if (interval) clearInterval(interval);
    };
  }, [ticker, play, bias, contextKey, liveSession, emit, sessionFlows, paused, excludeOccs]);

  return { picks, loading };
}
