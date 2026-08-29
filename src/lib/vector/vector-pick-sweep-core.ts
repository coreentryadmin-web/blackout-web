/**
 * Pure helpers for the server-side Vector pick universe sweep — testable without DB/providers.
 */
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorPlayPickContext } from "@/features/vector/lib/vector-play-candidates";
import type { VectorPickActionStatus } from "@/features/vector/lib/vector-pick-live-status";

export const VECTOR_PICK_WINNER_PCT_FLOOR = 50;
export const VECTOR_PICK_LEADER_PCT_FLOOR = 15;
/** Cap merged universe + hot-ticker sweep list (hot names first). */
export const VECTOR_SWEEP_TICKER_CAP = 64;

/** Hot HELIX names first, then the static Vector universe — deduped, capped. */
export function mergeSweepTickerUniverse(
  base: readonly string[],
  hot: readonly string[],
  maxTotal = VECTOR_SWEEP_TICKER_CAP
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const u = raw.trim().toUpperCase();
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const t of hot) push(t);
  for (const t of base) push(t);
  return out.slice(0, Math.max(1, maxTotal));
}

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

/** Closed pick archived at/above winner floor — surfaces in Winners even after Don't buy. */
export function isVectorPickClosureWinner(row: {
  premium_pct_from_entry: number | null;
}): boolean {
  const pct = row.premium_pct_from_entry;
  return pct != null && Number.isFinite(pct) && pct >= VECTOR_PICK_WINNER_PCT_FLOOR;
}

export function sortLeadersForBoard<
  T extends {
    premium_pct_from_entry: number | null;
    peak_premium_pct: number | null;
    pick_context?: Record<string, unknown> | null;
    tier?: string | null;
  },
>(rows: T[]): T[] {
  const isElite = (r: T): boolean =>
    r.tier === "elite" ||
    Boolean(
      r.pick_context &&
        typeof r.pick_context.tier === "string" &&
        r.pick_context.tier === "elite"
    );
  return [...rows].sort((a, b) => {
    const eliteDelta = Number(isElite(b)) - Number(isElite(a));
    if (eliteDelta !== 0) return eliteDelta;
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
