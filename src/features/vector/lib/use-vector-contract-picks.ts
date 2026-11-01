"use client";

import { useEffect, useRef, useState } from "react";
import { fetchVectorContractPicks, type VectorContractPick } from "@/lib/api";
import type { VectorPlayEmit } from "./vector-play-engine";
import { vectorContractPickFetchKey } from "./vector-pick-context-key";
import { effectivePickBias } from "./vector-pick-effective-bias";
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
  excludeOccs: readonly string[] = [],
  refetchToken = 0
): { picks: VectorContractPick[]; loading: boolean } {
  const [picks, setPicks] = useState<VectorContractPick[]>([]);
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const play = emit?.play ?? null;
  const bias = play ? effectivePickBias(play, emit?.spot, emit?.gammaFlip) ?? play.bias : null;
  const contextKey = vectorContractPickFetchKey(emit, sessionFlows.length, excludeOccs);

  // BUG FIX (round 180 audit): `emit`/`play`/`sessionFlows` get a NEW object/array identity on
  // every render where any field changes — including fields `contextKey` deliberately leaves out
  // (grade, entryZone, technicals, confluenceZones, darkPoolLevels, magnetStrike, regimePosture,
  // gammaFlip; and sessionFlows is compared by `.length` only, not identity, per
  // vectorContractPickFetchKey's own doc comment). `contextKey` exists precisely so this hook only
  // restarts its debounce/45s-refresh timers on a semantically relevant change — the SAME pattern
  // `useVectorActionablePicks`'s own archive-reset effect already uses (`[ticker, contextKey]`,
  // never raw `emit`). Previously this effect's own dependency array ALSO listed the raw `emit`,
  // `play` and `sessionFlows` on top of `contextKey`, so it tore down and rebuilt the debounce
  // timer and the periodic interval on every one of those extra, noisier reference changes too —
  // defeating contextKey's whole purpose. Worse: if updates arrive faster than DEBOUNCE_MS (500ms),
  // the pending `setTimeout(load, DEBOUNCE_MS)` is cancelled and rescheduled every time before it
  // ever fires, so the pool can go unfetched indefinitely during an active tape. Fresh emit/play/
  // sessionFlows values still reach `load()` — via refs updated every render below — so a periodic
  // refresh keeps using current desk context without needing the effect itself to restart.
  const emitRef = useRef(emit);
  emitRef.current = emit;
  const playRef = useRef(play);
  playRef.current = play;
  const sessionFlowsRef = useRef(sessionFlows);
  sessionFlowsRef.current = sessionFlows;

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
      const emitNow = emitRef.current;
      const playNow = playRef.current;
      if (!emitNow || !playNow) return;
      setLoading(true);
      fetchVectorContractPicks({
        ticker,
        play: playNow,
        spot: emitNow.spot,
        callWall: emitNow.callWall,
        putWall: emitNow.putWall,
        magnetStrike: emitNow.magnetStrike,
        gammaFlip: emitNow.gammaFlip,
        regimePosture: emitNow.regimePosture,
        technicals: emitNow.technicals,
        confluenceZones: emitNow.confluenceZones?.map((z) => ({
          center: z.center,
          score: z.score,
          kinds: z.kinds,
        })),
        darkPoolLevels: emitNow.darkPoolLevels,
        excludeOccs: excludeOccs.length ? [...excludeOccs] : undefined,
        flows: sessionFlowsRef.current.map((f) => ({
          option_type: f.option_type,
          premium: f.premium,
          strike: f.strike,
          expiry: f.expiry,
          ask_pct: f.ask_pct,
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
    // emit/play/sessionFlows are read via the refs above (always current); contextKey is the
    // deliberately-debounced trigger for restarting the timers — see the comment on emitRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, bias, contextKey, liveSession, paused, excludeOccs, refetchToken]);

  return { picks, loading };
}
