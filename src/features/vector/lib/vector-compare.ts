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
): Promise<T[]> {
  const uniq = parseCompareTickers(tickers.join(","));
  if (!uniq.length) return [];
  const out: T[] = new Array(uniq.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, uniq.length) }, async () => {
    while (next < uniq.length) {
      const i = next++;
      out[i] = await fetchSeed(uniq[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
