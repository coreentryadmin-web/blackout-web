import type { FlowAlert } from "@/lib/api";
import {
  daysToExpiry,
  sortFlows,
  type HelixFlowSortDir,
  type HelixFlowSortKey,
} from "@/features/helix/lib/helix-flow-format";

export const VECTOR_HELIX_MIN_PREMIUM = 200_000;
export const VECTOR_HELIX_WHALE_PREMIUM = 1_000_000;
/** How many cards the Vector desk rail shows — a highlight reel, not the full Helix tape. */
export const VECTOR_HELIX_MAJOR_TOP_N = 12;
/** Fetch pool size — enough to rank major prints without loading the whole session tape. */
export const VECTOR_HELIX_FETCH_LIMIT = 40;
/** @deprecated Use VECTOR_HELIX_FETCH_LIMIT — kept for any stale imports. */
export const VECTOR_HELIX_PAGE_SIZE = VECTOR_HELIX_FETCH_LIMIT;
/** Default premium floor for the Vector major-prints rail (full Helix tape stays at $200k). */
export const VECTOR_HELIX_MAJOR_MIN_PREMIUM = 350_000;

export type VectorHelixTypeFilter = "ALL" | "CALL" | "PUT";

export type VectorHelixFlowFilters = {
  typeFilter: VectorHelixTypeFilter;
  whalesOnly: boolean;
  dteOnly: boolean;
  minPremium: number;
};

export const VECTOR_HELIX_DEFAULT_FILTERS: VectorHelixFlowFilters = {
  typeFilter: "ALL",
  whalesOnly: false,
  dteOnly: false,
  minPremium: VECTOR_HELIX_MAJOR_MIN_PREMIUM,
};

/** Client-side tape filters for the Vector Helix rail (server already scopes ticker). */
export function filterVectorHelixFlows(
  flows: readonly FlowAlert[],
  filters: VectorHelixFlowFilters
): FlowAlert[] {
  const floor = Math.max(VECTOR_HELIX_MIN_PREMIUM, filters.minPremium);
  return flows.filter((f) => {
    const side = f.option_type?.toUpperCase();
    if (side !== "CALL" && side !== "PUT") return false;
    if (f.premium < floor) return false;
    if (filters.whalesOnly && f.premium < VECTOR_HELIX_WHALE_PREMIUM) return false;
    if (filters.typeFilter !== "ALL" && side !== filters.typeFilter) return false;
    if (filters.dteOnly) {
      const dte = f.dte ?? daysToExpiry(f.expiry);
      if (dte !== 0) return false;
    }
    return true;
  });
}

export function sortVectorHelixFlows(
  flows: readonly FlowAlert[],
  sortKey: HelixFlowSortKey,
  sortDir: HelixFlowSortDir
): FlowAlert[] {
  const sorted = sortFlows([...flows], sortKey, sortDir);
  if (sortKey === "time") return sorted;
  return sorted;
}

/** Curated major prints for the Vector desk — top N by premium after filters. */
export function pickVectorHelixMajorFlows(
  flows: readonly FlowAlert[],
  filters: VectorHelixFlowFilters,
  limit = VECTOR_HELIX_MAJOR_TOP_N
): FlowAlert[] {
  const filtered = filterVectorHelixFlows(flows, filters);
  return sortVectorHelixFlows(filtered, "premium", "desc").slice(0, limit);
}

/** Trim the in-memory pool so live SSE merges do not grow an unbounded full tape. */
export function trimVectorHelixFlowPool(
  flows: readonly FlowAlert[],
  cap = VECTOR_HELIX_FETCH_LIMIT
): FlowAlert[] {
  return sortVectorHelixFlows(flows, "premium", "desc").slice(0, cap);
}
