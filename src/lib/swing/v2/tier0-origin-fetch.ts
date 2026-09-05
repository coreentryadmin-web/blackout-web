/**
 * Tier-0 origin fetch observability (deep-dive Q27).
 * Distinguishes "origin returned zero names" from "origin fetch threw".
 */

export type Tier0V2OriginKind = "POSITIONING" | "CATALYST" | "BANGER" | "VECTOR";

export interface Tier0OriginFetchResult {
  tickers: string[];
  /** True when the fetcher threw — distinct from a legitimate empty screen. */
  fetchError: boolean;
}

/** Run a Tier-0 origin fetch; empty + fetchError on throw (never rethrow). */
export async function fetchTier0OriginTickers(
  kind: Tier0V2OriginKind,
  fetcher: () => Promise<string[]>,
): Promise<Tier0OriginFetchResult> {
  try {
    const tickers = await fetcher();
    return { tickers, fetchError: false };
  } catch (err) {
    console.warn(`[swing-discovery] Tier-0 origin ${kind} fetch failed:`, err);
    return { tickers: [], fetchError: true };
  }
}
