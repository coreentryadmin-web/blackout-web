/**
 * Pure helpers for the server-side Vector pick universe sweep — testable without DB/providers.
 */
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorPlayPickContext } from "@/features/vector/lib/vector-play-candidates";
import type { VectorPickActionStatus } from "@/features/vector/lib/vector-pick-live-status";
import { effectivePickBias } from "@/features/vector/lib/vector-pick-effective-bias";

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
  if (!play || spot == null || spot <= 0) return null;
  // A committed `pivot` play's raw card bias stays "neutral" by design (long above / short
  // below, until spot commits) — gating on the raw field here silently skipped the whole
  // ticker for every committed pivot play (2026-08-29 audit finding, same root cause as the
  // already-fixed contract-picks/live/route.ts bug, in this server sweep's own call site).
  // Re-derive the committed direction the same way vector-play-candidates.ts ranks picks;
  // `bias == null` covers both a genuinely neutral non-pivot play and an uncommitted pivot.
  const bias = effectivePickBias(play, spot, state.gammaFlip);
  if (bias == null) return null;

  const numOrNull = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

  return {
    play: bias === play.bias ? play : { ...play, bias },
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

/**
 * The entry basis a sweep pass must measure live drift against: the row's FROZEN `entry_mid`
 * (first-write-wins in the DB — `upsertVectorPickLeader` never updates it) when the row already
 * exists, never a freshly re-derived pick premium. `buildRankedVectorPicks` re-ranks against the
 * live chain every sweep pass (~2min RTH), so the same rank/role/occ can carry a different
 * premium pass to pass — feeding that into `premiumPctFromEntry` on a later pass silently
 * re-bases the member-facing % onto a moving target while the displayed `entry_mid` field stays
 * pinned at its original value, so the two visibly stop reconciling (found live 2026-08-31: QQQ
 * showed `entry_mid` $1.94 next to a -2.11% read that only reconciles against a $1.42 basis).
 */
export function resolveVectorPickEntryMid(
  frozenEntryMid: number | null,
  pickEntryMid: number | null | undefined,
  pickPremium: number | null | undefined
): number | null {
  return frozenEntryMid ?? pickEntryMid ?? pickPremium ?? null;
}

/** +15%…+49% live names building toward the +50% winner floor — not yet archived as winners. */
export function isVectorPickRunner(row: {
  premium_pct_from_entry: number | null;
  peak_premium_pct: number | null;
  action_status: string;
}): boolean {
  if (isVectorPickWinner(row)) return false;
  const best = Math.max(
    row.premium_pct_from_entry ?? Number.NEGATIVE_INFINITY,
    row.peak_premium_pct ?? Number.NEGATIVE_INFINITY
  );
  return best >= VECTOR_PICK_LEADER_PCT_FLOOR && best < VECTOR_PICK_WINNER_PCT_FLOOR;
}
