/**
 * POSITIONING Tier-0 screen — batch GEX reads for Vector leader tickers (V2 P2).
 *
 * Full whole-market GEX scan is deferred (provider budget); seeds from vector_pick_leaders
 * and scores each with scorePositioningForSwing.
 */

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { scorePositioningForSwing, type PositioningOriginCandidate } from "./positioning";

export async function screenPositioningFromTickers(
  tickers: string[],
  opts: { concurrency?: number } = {},
): Promise<PositioningOriginCandidate[]> {
  const uniq = [...new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))].slice(0, 60);
  if (uniq.length === 0) return [];

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 6, 12));
  const out: PositioningOriginCandidate[] = [];
  let next = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const idx = next++;
        if (idx >= uniq.length) return;
        const ticker = uniq[idx]!;
        const gex = await getGexPositioning(ticker).catch(() => null);
        const hit = scorePositioningForSwing(gex);
        if (hit) out.push(hit);
      }
    }),
  );

  return out.sort((a, b) => b.score - a.score);
}

/** Tickers admitted by POSITIONING origin (for Tier-0 merge). */
export async function positioningTickersFromVectorLeaders(
  leaderTickers: string[],
): Promise<string[]> {
  const hits = await screenPositioningFromTickers(leaderTickers);
  return hits.map((h) => h.ticker);
}
