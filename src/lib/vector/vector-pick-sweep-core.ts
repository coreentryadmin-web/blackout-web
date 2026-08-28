/**
 * Pure helpers for the server-side Vector pick universe sweep — testable without DB/providers.
 */
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorPlayPickContext } from "@/features/vector/lib/vector-play-candidates";
import type { VectorPickActionStatus } from "@/features/vector/lib/vector-pick-live-status";

export const VECTOR_PICK_WINNER_PCT_FLOOR = 50;
export const VECTOR_PICK_LEADER_PCT_FLOOR = 15;

export function vectorPickLeaderKey(sessionDate: string, ticker: string, occ: string): string {
  return `${sessionDate}:${ticker.trim().toUpperCase()}:${occ.trim().toUpperCase()}`;
}

export function pickContextFromFullState(state: VectorFullState): VectorPlayPickContext | null {
  const play = state.play;
  const spot = state.spot;
  if (!play || play.bias === "neutral" || spot == null || spot <= 0) return null;

  const numOrNull = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

  return {
    play,
    spot,
    callWall: numOrNull(state.gexWalls?.callWalls?.[0]?.strike),
    putWall: numOrNull(state.gexWalls?.putWalls?.[0]?.strike),
    magnetStrike: numOrNull(state.magnet?.strike),
    gammaFlip: numOrNull(state.gammaFlip),
    regimePosture: state.regime?.posture ?? null,
    technicals: state.technicals ?? null,
    confluenceZones: state.confluenceZones ?? null,
    platformInputs: state.platformInputs ?? { sessionFlows: [], darkPoolLevels: [] },
  };
}

export function mergePeakPremiumPct(
  prevPeak: number | null | undefined,
  current: number | null | undefined
): number | null {
  const cur = current != null && Number.isFinite(current) ? current : null;
  const prev = prevPeak != null && Number.isFinite(prevPeak) ? prevPeak : null;
  if (cur == null) return prev;
  if (prev == null) return cur;
  return Math.max(prev, cur);
}

export type VectorPickLeaderBoardRow = {
  leader_key: string;
  session_date: string;
  ticker: string;
  occ: string;
  side: string;
  strike: number;
  expiry: string;
  rank: number | null;
  label: string | null;
  role: string | null;
  entry_mid: number | null;
  live_mid: number | null;
  premium_pct_from_entry: number | null;
  peak_premium_pct: number | null;
  action_status: VectorPickActionStatus;
  action_reason: string;
  setup_invalidated: boolean;
  spot: number | null;
  vector_play: Record<string, unknown> | null;
  pick_context: Record<string, unknown> | null;
  updated_at: string;
};

export function isVectorPickWinner(row: {
  premium_pct_from_entry: number | null;
  peak_premium_pct: number | null;
  action_status: string;
}): boolean {
  const live = row.premium_pct_from_entry;
  const peak = row.peak_premium_pct;
  const floor = VECTOR_PICK_WINNER_PCT_FLOOR;
  if (live != null && live >= floor) return true;
  if (peak != null && peak >= floor && row.action_status !== "dont_buy") return true;
  return false;
}

export function sortLeadersForBoard<T extends { premium_pct_from_entry: number | null; peak_premium_pct: number | null }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const aPct = Math.max(a.premium_pct_from_entry ?? -Infinity, a.peak_premium_pct ?? -Infinity);
    const bPct = Math.max(b.premium_pct_from_entry ?? -Infinity, b.peak_premium_pct ?? -Infinity);
    return bPct - aPct;
  });
}

export function leaderEligibleForBoard(row: {
  premium_pct_from_entry: number | null;
  peak_premium_pct: number | null;
  action_status: string;
}): boolean {
  if (row.action_status === "still_buy" || row.action_status === "caution") return true;
  const pct = row.premium_pct_from_entry ?? row.peak_premium_pct;
  return pct != null && pct >= VECTOR_PICK_LEADER_PCT_FLOOR;
}
