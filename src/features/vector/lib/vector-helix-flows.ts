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
/** Preferred premium floor for liquid names (SPX/NVDA). Thin tickers fall back — see pickVectorHelixMajorFlows. */
export const VECTOR_HELIX_MAJOR_MIN_PREMIUM = 350_000;

export type VectorHelixMajorTier = "major" | "session";

export type VectorHelixMajorPick = {
  flows: FlowAlert[];
  /** major = ≥ preferred floor; session = top prints from the $200k fetch pool when nothing clears major. */
  tier: VectorHelixMajorTier;
  effectiveMinPremium: number;
};

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

function sideAndFlagsFilter(
  flows: readonly FlowAlert[],
  filters: VectorHelixFlowFilters
): FlowAlert[] {
  return flows.filter((f) => {
    const side = f.option_type?.toUpperCase();
    if (side !== "CALL" && side !== "PUT") return false;
    if (filters.whalesOnly && f.premium < VECTOR_HELIX_WHALE_PREMIUM) return false;
    if (filters.typeFilter !== "ALL" && side !== filters.typeFilter) return false;
    if (filters.dteOnly) {
      const dte = f.dte ?? daysToExpiry(f.expiry);
      if (dte !== 0) return false;
    }
    return true;
  });
}

/** Client-side tape filters for the Vector Helix rail (server already scopes ticker). */
export function filterVectorHelixFlows(
  flows: readonly FlowAlert[],
  filters: VectorHelixFlowFilters
): FlowAlert[] {
  const floor = Math.max(VECTOR_HELIX_MIN_PREMIUM, filters.minPremium);
  return sideAndFlagsFilter(flows, filters).filter((f) => f.premium >= floor);
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

/** Curated major prints — top N by premium. Uses $350k+ when available; otherwise top session prints (≥$200k). */
export function pickVectorHelixMajorFlows(
  flows: readonly FlowAlert[],
  filters: VectorHelixFlowFilters,
  limit = VECTOR_HELIX_MAJOR_TOP_N
): VectorHelixMajorPick {
  const preferredFloor = Math.max(VECTOR_HELIX_MAJOR_MIN_PREMIUM, filters.minPremium);
  const strict = sideAndFlagsFilter(flows, filters).filter((f) => f.premium >= preferredFloor);
  const strictTop = sortVectorHelixFlows(strict, "premium", "desc").slice(0, limit);
  if (strictTop.length > 0) {
    return {
      flows: strictTop,
      tier: "major",
      effectiveMinPremium: preferredFloor,
    };
  }

  const relaxedFloor = VECTOR_HELIX_MIN_PREMIUM;
  const relaxed = sideAndFlagsFilter(flows, filters).filter((f) => f.premium >= relaxedFloor);
  const relaxedTop = sortVectorHelixFlows(relaxed, "premium", "desc").slice(0, limit);
  return {
    flows: relaxedTop,
    tier: "session",
    effectiveMinPremium: relaxedTop.length > 0 ? relaxedTop[relaxedTop.length - 1]!.premium : relaxedFloor,
  };
}

/** Subtitle copy — honest about which floor tier is active. */
export function vectorHelixMajorSubtitle(pick: VectorHelixMajorPick): string {
  if (pick.flows.length === 0) return `Top ${VECTOR_HELIX_MAJOR_TOP_N} by premium · session`;
  if (pick.tier === "major") {
    return `Top ${VECTOR_HELIX_MAJOR_TOP_N} by premium · ≥${formatHelixPremiumFloor(pick.effectiveMinPremium)}`;
  }
  const top = pick.flows[0]!.premium;
  return `Top ${VECTOR_HELIX_MAJOR_TOP_N} by premium · largest today (≥${formatHelixPremiumFloor(pick.effectiveMinPremium)})`;
}

function formatHelixPremiumFloor(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** Trim the in-memory pool so live SSE merges do not grow an unbounded full tape. */
export function trimVectorHelixFlowPool(
  flows: readonly FlowAlert[],
  cap = VECTOR_HELIX_FETCH_LIMIT
): FlowAlert[] {
  return sortVectorHelixFlows(flows, "premium", "desc").slice(0, cap);
}
