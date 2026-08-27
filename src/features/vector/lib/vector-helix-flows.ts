import type { FlowAlert } from "@/lib/api";
import { flowDedupeKey } from "@/features/helix/lib/helix-flow-tape-merge";
import { sessionOpenMs } from "@/lib/largo/temporal/timeframe";
import {
  daysToExpiry,
  sortFlows,
  type HelixFlowSortDir,
  type HelixFlowSortKey,
} from "@/features/helix/lib/helix-flow-format";

export const VECTOR_HELIX_MIN_PREMIUM = 200_000;
export const VECTOR_HELIX_WHALE_PREMIUM = 1_000_000;
/** Max prints shown on the Live Helix rail — top by premium for the live session. */
export const VECTOR_LIVE_HELIX_TAPE_CAP = 40;
/** Session seed fetch — enough rows to rank today's top prints (API returns recent-first). */
export const VECTOR_LIVE_HELIX_SESSION_FETCH_LIMIT = 200;
/** Recent strip — latest prints by time (above premium-ranked session list). Raised from 3 to 15
 *  per operator feedback (2026-08-27): a 3-row strip read as near-empty next to a "40 prints
 *  today" subtitle. */
export const VECTOR_LIVE_HELIX_RECENT_N = 15;
/** Top-by-premium DISPLAY cap for the rail. Deliberately separate from `VECTOR_LIVE_HELIX_TAPE_CAP`
 *  (the 40-row in-memory pool cap, still used for fetch/trim) — the rail itself now shows 15 to
 *  match Recent, per operator feedback. */
export const VECTOR_LIVE_HELIX_RANKED_DISPLAY_N = 15;
/**
 * DTE ceilings for the rail's two sections — the fix for "random flows... a 500-day-out print
 * nobody cares about" (operator, 2026-08-27). Both sections previously ranked/sorted across the
 * FULL DTE range with no ceiling at all, so a single far-dated LEAPS whale (measured live on SPX:
 * a $31.4M print at 85 DTE, a $30.4M print at 113 DTE, several $5-16M prints at 294-386 DTE) sat
 * at the top of "Top by premium" ahead of every same-day/near-dated print a member actually cares
 * about on an intraday desk. Recent gets the tighter ceiling since it's explicitly framed as
 * "today's session" prints; Top by premium gets a slightly wider one so a legitimate
 * few-weeks-out monthly print (this repo's own "monthly" DTE horizon convention in
 * `vector-dte-horizon.ts` ceilings at 35) still has headroom to rank, while five-figure-day LEAPS
 * prints are excluded either way.
 */
export const VECTOR_HELIX_RECENT_MAX_DTE = 30;
export const VECTOR_HELIX_RANKED_MAX_DTE = 45;
/**
 * Pool-level DTE ceiling — deliberately WIDER than both section ceilings above (with headroom)
 * so the pool trim itself never crowds near-dated prints out ahead of the per-section filters
 * running. `trimVectorHelixFlowPool` keeps the pool's top-`cap` prints BY PREMIUM, and premium
 * alone does not correlate with DTE — measured live: for SPX, the top 40 prints by premium
 * (out of a 200-row session fetch) were ALL >45 DTE, i.e. a premium-only trim discarded every
 * single near-dated print before the rail's own DTE filter ever ran. Bounding the pool by DTE
 * first (with the same honest nearest-DTE fallback as the section filters, so a genuinely
 * LEAPS-only illiquid ticker never goes blank) fixes that at the source.
 */
export const VECTOR_HELIX_POOL_MAX_DTE = 60;
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

/** DTE for a flow — prefer the API's own field, fall back to deriving it from expiry. */
function flowDte(f: FlowAlert): number {
  return f.dte ?? daysToExpiry(f.expiry);
}

/**
 * Keep only flows within `maxDte` (inclusive). HONEST FALLBACK: if the ceiling matches nothing
 * at all (e.g. an illiquid ticker whose only prints today are LEAPS), return the `fallbackN`
 * NEAREST-dated flows instead of an empty list — a bounded window must never blank a section
 * that has real data, only re-rank what it shows. Mirrors the same "return the nearest instead
 * of nothing" rule `expiriesForHorizon` already uses for wall expiries (`vector-dte-horizon.ts`).
 * When some flows DO fall inside the window, the window is respected exactly — no partial widen.
 */
export function filterByMaxDte(
  flows: readonly FlowAlert[],
  maxDte: number,
  fallbackN: number
): FlowAlert[] {
  const within = flows.filter((f) => flowDte(f) <= maxDte);
  if (within.length > 0 || flows.length === 0) return within;
  return [...flows].sort((a, b) => flowDte(a) - flowDte(b)).slice(0, fallbackN);
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

/** Keep only prints from today's RTH session (client guard after a since-hours fetch). */
export function filterFlowsSinceSessionOpen(
  flows: readonly FlowAlert[],
  sessionOpenMs: number
): FlowAlert[] {
  return flows.filter((f) => isFlowSinceSessionOpen(f, sessionOpenMs));
}

/** Hours to request from /flows — from today's 09:30 ET open through now (min 1, max 24). */
export function hoursSinceSessionOpen(nowMs = Date.now()): number {
  const openMs = typeof nowMs === "number" ? sessionOpenMs(nowMs) : sessionOpenMs(Date.now());
  const elapsed = nowMs - openMs;
  if (elapsed <= 0) return 1;
  return Math.min(Math.max(Math.ceil(elapsed / 3_600_000), 1), 24);
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

/** Premium desc, then newest — session #1 stays #1 until a larger print arrives live. */
export function compareLiveHelixByPremium(a: FlowAlert, b: FlowAlert): number {
  if (b.premium !== a.premium) return b.premium - a.premium;
  return flowAlertedMs(b) - flowAlertedMs(a);
}

/** Live Helix tape — ranked by premium (largest session print stays #1 all day). */
export function prepareVectorLiveHelixTape(
  flows: readonly FlowAlert[],
  filters: VectorHelixFlowFilters,
  cap = VECTOR_LIVE_HELIX_TAPE_CAP
): FlowAlert[] {
  return filterVectorHelixFlows(flows, filters)
    .sort(compareLiveHelixByPremium)
    .slice(0, cap);
}

export type VectorLiveHelixLayout = {
  recent: FlowAlert[];
  ranked: FlowAlert[];
};

/**
 * Live Helix layout — Recent strip (newest by time, excluding session #1) +
 * premium-ranked session list. Session leader always lives in ranked as #1.
 */
export function pickVectorLiveHelixLayout(
  flows: readonly FlowAlert[],
  filters: VectorHelixFlowFilters,
  opts: {
    recentN?: number;
    rankedCap?: number;
    recentMaxDte?: number;
    rankedMaxDte?: number;
  } = {}
): VectorLiveHelixLayout {
  const recentN = opts.recentN ?? VECTOR_LIVE_HELIX_RECENT_N;
  const rankedCap = opts.rankedCap ?? VECTOR_LIVE_HELIX_RANKED_DISPLAY_N;
  const recentMaxDte = opts.recentMaxDte ?? VECTOR_HELIX_RECENT_MAX_DTE;
  const rankedMaxDte = opts.rankedMaxDte ?? VECTOR_HELIX_RANKED_MAX_DTE;
  const eligible = filterVectorHelixFlows(flows, filters);

  // Each section gets its OWN near-dated pool — Recent's is tighter than Ranked's — so a
  // 400+ day LEAPS print can never win "top by premium" or "recent" just because it is the
  // single largest number in the unfiltered set. See the constants' doc comments for why
  // these particular ceilings (and the live SPX evidence that motivated them).
  const nearDatedForRanked = filterByMaxDte(eligible, rankedMaxDte, rankedCap);
  const nearDatedForRecent = filterByMaxDte(eligible, recentMaxDte, recentN);

  const rankedFull = [...nearDatedForRanked].sort(compareLiveHelixByPremium);
  const leader = rankedFull[0];
  const leaderKey = leader ? flowDedupeKey(leader) : null;

  const recent = sortVectorHelixFlows(nearDatedForRecent, "time", "desc")
    .filter((f) => !leaderKey || flowDedupeKey(f) !== leaderKey)
    .slice(0, recentN);

  const recentKeys = new Set(recent.map((f) => flowDedupeKey(f)));
  const ranked = rankedFull
    .filter((f) => !recentKeys.has(flowDedupeKey(f)))
    .slice(0, rankedCap);

  return { recent, ranked };
}

/** Subtitle for the Live Helix header. */
export function vectorLiveHelixSubtitle(
  layout: Pick<VectorLiveHelixLayout, "recent" | "ranked">,
  liveSession: boolean
): string {
  const count = layout.recent.length + layout.ranked.length;
  if (!liveSession) return "Session closed · full history on Helix desk";
  if (count === 0) return "Recent + ranked by premium · today's session";
  const parts: string[] = [];
  if (layout.recent.length > 0) parts.push("Recent");
  parts.push(`ranked by premium · ${count} print${count === 1 ? "" : "s"} today`);
  return parts.join(" · ");
}

/**
 * Trim in-memory pool — keep the largest prints so an early session leader is never dropped.
 *
 * DTE-BOUNDED FIRST, then premium-sorted: a plain premium sort here would let a handful of
 * far-dated LEAPS whales fill the entire cap before ranking ever runs — measured live for SPX,
 * the top 40 prints by premium (of 200 fetched) were ALL >45 DTE, so every near-dated print was
 * discarded before `pickVectorLiveHelixLayout`'s own DTE filters could even see them. Bounding by
 * `VECTOR_HELIX_POOL_MAX_DTE` first (wider than either section ceiling, so it never itself
 * becomes the bottleneck) fixes that at the source rather than papering over it downstream.
 * Falls back to the nearest-DTE flows (not empty) if a ticker's whole pool is genuinely far-dated
 * — see `filterByMaxDte`.
 */
export function trimVectorHelixFlowPool(
  flows: readonly FlowAlert[],
  cap = VECTOR_LIVE_HELIX_TAPE_CAP,
  maxDte = VECTOR_HELIX_POOL_MAX_DTE
): FlowAlert[] {
  const nearDated = filterByMaxDte(flows, maxDte, cap);
  return [...nearDated].sort(compareLiveHelixByPremium).slice(0, cap);
}

/** Dedupe key set for excluding hot lane duplicates (legacy helper). */
export { flowDedupeKey };
