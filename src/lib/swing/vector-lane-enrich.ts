// Stamp Vector contract-pick corroboration onto Swing Command plays — signals only, no second ledger.
//
// Vector was a chart desk + closed-pick audit log, not an entry/exit system. Swing Command treats recent
// Vector leaders as enrichment: a WATCH/COMMIT row whose ticker has an active Vector leader gets VECTOR in
// signalKinds and a confluence bump on the desk card.

import type { HorizonPlay } from "../horizon-plays";

export const VECTOR_SIGNAL = "VECTOR";

export type VectorLeaderHint = {
  ticker: string;
  leaderKey?: string | null;
  peakPremiumPct?: number | null;
};

/** Index leader hints by uppercased ticker for O(1) lookup during lane assembly. */
export function vectorLeadersByTicker(hints: readonly VectorLeaderHint[]): Map<string, VectorLeaderHint> {
  const map = new Map<string, VectorLeaderHint>();
  for (const h of hints) {
    const tk = h.ticker?.trim().toUpperCase();
    if (tk) map.set(tk, h);
  }
  return map;
}

/** Add VECTOR provenance + optional score nudge when a leader exists for this ticker. */
export function enrichPlayWithVectorLeader(
  play: HorizonPlay,
  leader: VectorLeaderHint | null | undefined,
): HorizonPlay {
  if (!leader) return play;
  const kinds = new Set(play.signalKinds ?? []);
  kinds.add(VECTOR_SIGNAL);
  const bump =
    leader.peakPremiumPct != null && Number.isFinite(leader.peakPremiumPct)
      ? Math.min(8, Math.round(leader.peakPremiumPct / 5))
      : 3;
  return {
    ...play,
    signalKinds: [...kinds],
    score: Math.min(99, play.score + bump),
    reason: play.reason.includes("Vector")
      ? play.reason
      : `${play.reason} · Vector corroboration`,
  };
}

/** Apply Vector leader hints across a SWING play list (pure, idempotent). */
export function enrichSwingPlaysWithVectorLeaders(
  plays: readonly HorizonPlay[],
  leaders: readonly VectorLeaderHint[],
): HorizonPlay[] {
  if (leaders.length === 0) return [...plays];
  const byTicker = vectorLeadersByTicker(leaders);
  return plays.map((p) => enrichPlayWithVectorLeader(p, byTicker.get(p.ticker.toUpperCase())));
}
