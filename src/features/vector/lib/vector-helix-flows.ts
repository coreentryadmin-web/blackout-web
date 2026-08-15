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
/** Recent lane — day-traders watch what is hitting now while on beads/walls. */
export const VECTOR_HELIX_HOT_WINDOW_MIN = 20;
export const VECTOR_HELIX_HOT_TOP_N = 3;
/** Session leaders — largest prints today (deduped against hot lane). */
export const VECTOR_HELIX_SESSION_TOP_N = 12;
/** @deprecated Alias — session leader cap. */
export const VECTOR_HELIX_MAJOR_TOP_N = VECTOR_HELIX_SESSION_TOP_N;
/** Fetch pool size — enough to rank session leaders without loading the full tape. */
export const VECTOR_HELIX_FETCH_LIMIT = 40;
/** @deprecated Use VECTOR_HELIX_FETCH_LIMIT — kept for any stale imports. */
export const VECTOR_HELIX_PAGE_SIZE = VECTOR_HELIX_FETCH_LIMIT;

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

export type VectorHelixSessionPick = {
  hotNow: FlowAlert[];
  sessionLeaders: FlowAlert[];
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

function flowAlertedMs(f: FlowAlert): number {
  if (!f.alerted_at) return 0;
  const ms = new Date(f.alerted_at).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function premiumThenTimeDesc(a: FlowAlert, b: FlowAlert): number {
  if (b.premium !== a.premium) return b.premium - a.premium;
  return flowAlertedMs(b) - flowAlertedMs(a);
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

export type PickVectorHelixSessionOpts = {
  now?: Date;
  hotWindowMin?: number;
  hotTopN?: number;
  sessionTopN?: number;
};

/**
 * Session-wise Vector Helix curation: recent "hot" prints + largest session leaders.
 * No rigid major floor — thin names still surface their biggest session prints.
 */
export function pickVectorHelixSessionFlows(
  flows: readonly FlowAlert[],
  filters: VectorHelixFlowFilters,
  opts: PickVectorHelixSessionOpts = {}
): VectorHelixSessionPick {
  const nowMs = (opts.now ?? new Date()).getTime();
  const windowMs = (opts.hotWindowMin ?? VECTOR_HELIX_HOT_WINDOW_MIN) * 60_000;
  const hotTopN = opts.hotTopN ?? VECTOR_HELIX_HOT_TOP_N;
  const sessionTopN = opts.sessionTopN ?? VECTOR_HELIX_SESSION_TOP_N;

  const eligible = filterVectorHelixFlows(flows, filters);

  const hotNow = eligible
    .filter((f) => {
      const t = flowAlertedMs(f);
      return t > 0 && nowMs - t <= windowMs;
    })
    .sort(premiumThenTimeDesc)
    .slice(0, hotTopN);

  const hotKeys = new Set(hotNow.map((f) => flowDedupeKey(f)));

  const sessionLeaders = [...eligible]
    .sort(premiumThenTimeDesc)
    .filter((f) => !hotKeys.has(flowDedupeKey(f)))
    .slice(0, sessionTopN);

  return { hotNow, sessionLeaders };
}

/** Header subtitle — honest about hot window + session ranking. */
export function vectorHelixSessionSubtitle(
  pick: VectorHelixSessionPick,
  hotWindowMin = VECTOR_HELIX_HOT_WINDOW_MIN
): string {
  const hot = pick.hotNow.length;
  const leaders = pick.sessionLeaders.length;
  if (hot === 0 && leaders === 0) {
    return `Hot now · last ${hotWindowMin}m · Top ${VECTOR_HELIX_SESSION_TOP_N} by premium · session`;
  }
  const parts: string[] = [];
  if (hot > 0) parts.push(`Hot now · last ${hotWindowMin}m (${hot})`);
  if (leaders > 0) parts.push(`Top ${VECTOR_HELIX_SESSION_TOP_N} by premium · session`);
  return parts.join(" · ");
}

/** Trim the in-memory pool so live SSE merges do not grow an unbounded full tape. */
export function trimVectorHelixFlowPool(
  flows: readonly FlowAlert[],
  cap = VECTOR_HELIX_FETCH_LIMIT
): FlowAlert[] {
  return sortVectorHelixFlows(flows, "premium", "desc").slice(0, cap);
}
