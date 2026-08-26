"use client";

import { useEffect, useRef, useState } from "react";
import { fetchVectorContractPicks, type VectorContractPick } from "@/lib/api";
import type { VectorPlay } from "./vector-play-engine";

const REFRESH_MS = 45_000;
const DEBOUNCE_MS = 500;

/**
 * Fetches real contract picks for the current Suggested Play. Debounced against `play` churn
 * (the chart re-derives the play on every tick) and re-fetched on an interval while live so the
 * premium stays current, but a bias/conviction change that doesn't move the picked strike won't
 * cause a visible flicker — this only replaces `picks` when the response actually arrives.
 *
 * Degrades to `[]` (never stale/wrong picks) whenever the play has no directional leg to price
 * (`bias === "neutral"`) or a ticker change is mid-flight.
 *
 * Deliberately NOT parameterized by the chart's DTE horizon toggle — the pick's expiry is
 * independent of which DTE lens the walls happen to be shown through (see
 * `vector-contract-picks.ts`'s "BUG FIXED" note: this used to force a same-day contract whenever
 * the chart was on the 0DTE view, regardless of what the play actually called for).
 */
export function useVectorContractPicks(
  ticker: string,
  play: VectorPlay | null,
  liveSession: boolean
): { picks: VectorContractPick[]; loading: boolean } {
  const [picks, setPicks] = useState<VectorContractPick[]>([]);
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const bias = play?.bias ?? null;
  const conviction = play?.conviction ?? 0;

  useEffect(() => {
    if (!bias || bias === "neutral") {
      setPicks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const gen = ++genRef.current;

    const load = () => {
      setLoading(true);
      fetchVectorContractPicks({ ticker, bias, conviction })
        .then((res) => {
          if (cancelled || genRef.current !== gen) return;
          setPicks(res.picks ?? []);
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
  }, [ticker, bias, conviction, liveSession]);

  return { picks, loading };
}
