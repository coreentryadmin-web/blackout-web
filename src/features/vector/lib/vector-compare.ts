import { normalizeVectorTicker, isVectorTickerAllowed } from "./vector-ticker";

/** Hard cap — readability + client budget for chart-only panes. */
export const VECTOR_COMPARE_MAX_PANES = 4;

export type VectorComparePreset = {
  id: string;
  label: string;
  tickers: readonly string[];
};

/** One-click compare bundles — every name is universe-warm or oracle. */
export const VECTOR_COMPARE_PRESETS: readonly VectorComparePreset[] = [
  { id: "mag7", label: "Mag 7", tickers: ["NVDA", "AAPL", "MSFT", "AMZN"] },
  { id: "indices", label: "Indices", tickers: ["SPX", "SPY", "QQQ", "IWM"] },
  { id: "semis", label: "Semis", tickers: ["NVDA", "AMD", "SMH", "AVGO"] },
  { id: "momentum", label: "Momentum", tickers: ["TSLA", "META", "COIN", "MSTR"] },
] as const;

export function parseCompareTickers(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t || !isVectorTickerAllowed(t)) continue;
    const norm = normalizeVectorTicker(t);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= VECTOR_COMPARE_MAX_PANES) break;
  }
  return out;
}

/**
 * Which `compare` value the client should honour: the LIVE URL, never the page-load prop.
 *
 * This exists because the trap it prevents is invisible in review. `/vector` renders one client
 * component that receives `initialCompareRaw` (derived server-side from this same `compare` search
 * param) and also reads `useSearchParams()`. Writing the obvious
 *
 *   searchParams.get("compare") ?? initialCompareRaw
 *
 * looks like a harmless hydration fallback and is in fact a one-way door: "Exit compare" navigates
 * to `/vector`, the param goes away, `searchParams.get("compare")` correctly returns null — and the
 * `??` immediately hands back the value the URL had when the page FIRST loaded. Compare mode can be
 * entered but never left, and the same staleness breaks any other same-route navigation out of it.
 *
 * ABSENCE OF THE PARAM IS MEANINGFUL. The server prop is only ever a first-paint convenience, and
 * `/vector` is force-dynamic so the two always agree on first paint anyway — it can be ignored
 * outright. Kept as a named function so the rule is testable and the next reader sees the WHY.
 */
export function resolveCompareRaw(urlCompareParam: string | null | undefined): string | null {
  return urlCompareParam ?? null;
}

export function isCompareMode(compareParam: string | null | undefined): boolean {
  return compareParam != null && compareParam.length > 0;
}

/** Build `/vector` search string for compare mode. */
export function buildCompareSearch(tickers: string[]): string {
  const uniq = parseCompareTickers(tickers.join(","));
  if (!uniq.length) return "";
  const params = new URLSearchParams();
  params.set("compare", uniq.join(","));
  if (uniq[0] && uniq[0] !== "SPX") params.set("ticker", uniq[0]!);
  return `?${params.toString()}`;
}

export function comparePath(tickers: string[]): string {
  const qs = buildCompareSearch(tickers);
  return qs ? `/vector${qs}` : "/vector";
}

export function deskPath(ticker: string): string {
  const t = normalizeVectorTicker(ticker);
  return t === "SPX" ? "/vector" : `/vector?ticker=${encodeURIComponent(t)}`;
}

/** Load compare seeds with bounded concurrency — 4× parallel burst was tripping ALB 502s. */
export async function loadCompareSeedsBounded<T>(
  tickers: string[],
  fetchSeed: (ticker: string) => Promise<T>,
  concurrency = 2
): Promise<Array<T | null>> {
  const uniq = parseCompareTickers(tickers.join(","));
  if (!uniq.length) return [];
  const out: Array<T | null> = new Array(uniq.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, uniq.length) }, async () => {
    while (next < uniq.length) {
      const i = next++;
      // SETTLE PER ITEM, never reject the batch.
      //
      // THE BUG THIS FIXES (member-visible). A rejection here used to propagate out of the worker,
      // reject the Promise.all below, and throw out of the caller's void-ed async effect — so
      // `setCompareSeeds` was never called and the grid sat on "Loading Vector Compare…" FOREVER,
      // with no error state, no retry and no partial render. Ask for NVDA,META,AMD,TSLA and if AMD
      // alone fails you lose all four, including the primary seed that was already in hand.
      //
      // One unreachable ticker is a fact about that ticker, not a reason to lose the others. A null
      // slot lets the caller render the panes that DID load and mark the one that did not.
      try {
        out[i] = await fetchSeed(uniq[i]!);
      } catch {
        out[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}
