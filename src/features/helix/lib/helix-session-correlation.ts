/**
 * Time-lagged flow correlation — which tickers tend to print in the same direction
 * shortly after a leader print. Pure, offline over the visible session tape.
 */
import type { FlowAlert } from "@/lib/api";
import { flowEventTimeMs } from "@/lib/flow-timestamp";
import { printBias } from "@/features/helix/lib/helix-print-detail";

export const HELIX_CORRELATION_LAGS_MIN = [5, 10, 15] as const;
export type HelixCorrelationLagMin = (typeof HELIX_CORRELATION_LAGS_MIN)[number];

export type TickerPairCorrelation = {
  leader: string;
  follower: string;
  lagMin: HelixCorrelationLagMin;
  /** Share of leader prints followed by a same-direction follower print within lag. */
  rate: number;
  leaderPrints: number;
  followerHits: number;
};

type TimedPrint = {
  ticker: string;
  ms: number;
  bias: "bullish" | "bearish" | "neutral";
};

function timedPrints(alerts: readonly FlowAlert[]): TimedPrint[] {
  const out: TimedPrint[] = [];
  for (const a of alerts) {
    const ms = flowEventTimeMs(a);
    if (ms == null) continue;
    const bias = printBias(a);
    if (bias === "neutral") continue;
    out.push({ ticker: a.ticker.toUpperCase(), ms, bias });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

function printsByTicker(prints: readonly TimedPrint[]): Map<string, TimedPrint[]> {
  const map = new Map<string, TimedPrint[]>();
  for (const p of prints) {
    const list = map.get(p.ticker) ?? [];
    list.push(p);
    map.set(p.ticker, list);
  }
  return map;
}

function followerHitWithinLag(
  followerList: readonly TimedPrint[],
  startIdx: number,
  leaderMs: number,
  lagMs: number,
  bias: "bullish" | "bearish"
): boolean {
  for (let i = startIdx; i < followerList.length; i++) {
    const f = followerList[i]!;
    const delta = f.ms - leaderMs;
    if (delta < 0) continue;
    if (delta > lagMs) break;
    if (f.bias === bias) return true;
  }
  return false;
}

export function computeSessionFlowCorrelations(
  alerts: readonly FlowAlert[],
  opts?: {
    minPrintsPerTicker?: number;
    lags?: readonly HelixCorrelationLagMin[];
    maxPairs?: number;
  }
): TickerPairCorrelation[] {
  const minPrints = opts?.minPrintsPerTicker ?? 2;
  const lags = opts?.lags ?? HELIX_CORRELATION_LAGS_MIN;
  const maxPairs = opts?.maxPairs ?? 16;
  const prints = timedPrints(alerts);
  const byTicker = printsByTicker(prints);

  const tickers = [...byTicker.keys()].filter((t) => (byTicker.get(t)?.length ?? 0) >= minPrints);
  if (tickers.length < 2) return [];

  const results: TickerPairCorrelation[] = [];

  for (const leader of tickers) {
    const leaderList = byTicker.get(leader)!;
    for (const follower of tickers) {
      if (follower === leader) continue;
      const followerList = byTicker.get(follower)!;
      let followerIdx = 0;

      for (const lagMin of lags) {
        const lagMs = lagMin * 60 * 1000;
        let hits = 0;
        let leaders = 0;
        for (const lp of leaderList) {
          leaders += 1;
          const bias = lp.bias;
          if (bias === "neutral") continue;
          while (
            followerIdx < followerList.length &&
            followerList[followerIdx]!.ms < lp.ms
          ) {
            followerIdx += 1;
          }
          if (followerHitWithinLag(followerList, followerIdx, lp.ms, lagMs, bias)) {
            hits += 1;
          }
        }
        if (leaders < minPrints) continue;
        const rate = leaders > 0 ? hits / leaders : 0;
        if (hits === 0) continue;
        results.push({
          leader,
          follower,
          lagMin,
          rate,
          leaderPrints: leaders,
          followerHits: hits,
        });
      }
    }
  }

  return results
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        b.followerHits - a.followerHits ||
        b.leaderPrints - a.leaderPrints
    )
    .slice(0, maxPairs);
}
