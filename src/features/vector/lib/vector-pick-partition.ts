/**
 * Splits a ranked pick pool into actionable slots vs closed (Don't buy) picks, with backfill:
 * when rank #1–3 goes `dont_buy`, rank #4+ promotes into the active list up to `maxActive`.
 */
import type { VectorContractPick } from "./vector-contract-picks";

export type VectorPickPartition = {
  /** Up to `maxActive` picks that are still tradable (still_buy / caution / not yet evaluated). */
  active: VectorContractPick[];
  /** Picks the live monitor marked Don't buy — shown separately, not counted toward the cap. */
  closed: VectorContractPick[];
};

export const VECTOR_PICK_POOL_SIZE = 8;
export const VECTOR_PICK_MAX_ACTIVE = 3;

function pickRank(p: VectorContractPick, fallback: number): number {
  return p.rank ?? fallback;
}

function sortByRank(pool: readonly VectorContractPick[]): VectorContractPick[] {
  return [...pool].sort((a, b) => pickRank(a, 0) - pickRank(b, 0));
}

/** Renumber ranks 1…n for display after backfill. */
export function renumberPickRanks(picks: VectorContractPick[]): VectorContractPick[] {
  return picks.map((p, i) => ({ ...p, rank: i + 1 }));
}

/**
 * Partition a ranked pool using live action status. Closed picks are every `dont_buy`; active picks
 * are the next-best actionable contracts until `maxActive`.
 */
export function partitionVectorPicksByLiveStatus(
  pool: readonly VectorContractPick[],
  maxActive = VECTOR_PICK_MAX_ACTIVE
): VectorPickPartition {
  const sorted = sortByRank(pool);
  const closed: VectorContractPick[] = [];
  const active: VectorContractPick[] = [];

  for (const pick of sorted) {
    if (pick.actionStatus === "dont_buy") {
      closed.push(pick);
      continue;
    }
    if (active.length < maxActive) {
      active.push(pick);
    }
  }

  return {
    active: renumberPickRanks(active),
    closed: renumberPickRanks(closed),
  };
}

/** Merge newly archived closed picks with the current partition (dedupe by OCC or label). */
export function mergeArchivedClosedPicks(
  partition: VectorPickPartition,
  archivedClosed: readonly VectorContractPick[]
): VectorPickPartition {
  if (!archivedClosed.length) return partition;

  const key = (p: VectorContractPick) =>
    p.occ ?? `${p.side}-${p.strike}-${p.expiry}`;

  const seen = new Set<string>();
  const closed: VectorContractPick[] = [];

  for (const p of [...archivedClosed, ...partition.closed]) {
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    closed.push(p);
  }

  return { active: partition.active, closed: renumberPickRanks(closed) };
}
