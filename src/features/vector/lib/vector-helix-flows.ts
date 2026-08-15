import type { FlowAlert } from "@/lib/api";
import { flowDedupeKey } from "@/features/helix/lib/helix-flow-tape-merge";
import {
  daysToExpiry,
  sortFlows,
  type HelixFlowSortDir,
  type HelixFlowSortKey,
} from "@/features/helix/lib/helix-flow-format";

export const VECTOR_HELIX_MIN_PREMIUM = 200_000;
export const VECTOR_HELIX_WHALE_PREMIUM = 1_000_000;
/** Max prints kept in the Live Helix tape (newest-first). */
export const VECTOR_LIVE_HELIX_TAPE_CAP = 40;
/** @deprecated Alias for legacy imports. */
export const VECTOR_HELIX_FETCH_LIMIT = VECTOR_LIVE_HELIX_TAPE_CAP;
/** @deprecated Alias for legacy imports. */
export const VECTOR_HELIX_MAJOR_TOP_N = VECTOR_LIVE_HELIX_TAPE_CAP;
/** @deprecated Alias for legacy imports. */
export const VECTOR_HELIX_PAGE_SIZE = VECTOR_LIVE_HELIX_TAPE_CAP;

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
  minPremium: VECTOR_HELIX_MIN_PREMIUM,
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

export function flowAlertedMs(f: FlowAlert): number {
  if (!f.alerted_at) return 0;
  const ms = new Date(f.alerted_at).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** True when a print belongs to today's live RTH session (09:30 ET onward). */
export function isFlowSinceSessionOpen(flow: FlowAlert, sessionOpenMs: number): boolean {
  const ms = flowAlertedMs(flow);
  return ms > 0 && ms >= sessionOpenMs;
}

/** Client-side tape filters for the Vector Live Helix rail (server already scopes ticker). */
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
  return sortFlows([...flows], sortKey, sortDir);
}

/** Live Helix tape — newest prints first, capped. */
export function prepareVectorLiveHelixTape(
  flows: readonly FlowAlert[],
  filters: VectorHelixFlowFilters,
  cap = VECTOR_LIVE_HELIX_TAPE_CAP
): FlowAlert[] {
  return sortVectorHelixFlows(filterVectorHelixFlows(flows, filters), "time", "desc").slice(
    0,
    cap
  );
}

/** Subtitle for the Live Helix header. */
export function vectorLiveHelixSubtitle(count: number, liveSession: boolean): string {
  if (!liveSession) return "Session closed · full history on Helix desk";
  if (count === 0) return "Live tape · prints appear as they hit";
  return `Live tape · ${count} print${count === 1 ? "" : "s"} today`;
}

/** Trim in-memory pool — keep newest prints (live tape, not premium-ranked). */
export function trimVectorHelixFlowPool(
  flows: readonly FlowAlert[],
  cap = VECTOR_LIVE_HELIX_TAPE_CAP
): FlowAlert[] {
  return sortVectorHelixFlows(flows, "time", "desc").slice(0, cap);
}

/** Dedupe key set for excluding hot lane duplicates (legacy helper). */
export { flowDedupeKey };
