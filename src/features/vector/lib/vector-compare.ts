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
  // Label only, NOT the id: this preset was displayed as "Mag 7" while only ever carrying 4
  // tickers (capped by VECTOR_COMPARE_MAX_PANES=4, 3 short of the real Magnificent Seven).
  // `id: "mag7"` is kept — it's a stable key referenced by src/lib/x-intel/capture-catalog.ts's
  // `preset=mag7` param — renaming it would silently break that capture recipe.
  { id: "mag7", label: "Big Tech", tickers: ["NVDA", "AAPL", "MSFT", "AMZN"] },
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

/**
 * Drop any per-ticker record (meta/regime, play-desk snapshot, …) whose ticker is no longer in
 * the active compare set, returning the SAME object reference when nothing changed so callers can
 * skip a redundant re-render.
 *
 * THE BUG THIS FIXES (member-visible, VectorCompareDesk). `metaByTicker` (regime posture + spot,
 * shown as the long-γ/short-γ chip in the compare summary footer) was ONLY ever pruned inside
 * `removeTicker`'s own explicit `delete`. That covers removing one pane via its own ✕ button, but
 * not `applyPreset` swapping the whole seeds array at once (e.g. "Big Tech" → "Indices" → "Big
 * Tech" again) — a stale posture for a ticker that left and came back could sit in state and render
 * for however long it took the freshly-mounted pane's OWN regime fetch to overwrite it, showing a
 * real but OUTDATED gamma posture as if it were current. `playByTicker` already had exactly this
 * cleanup (a `useEffect` keyed on `seeds` that prunes anything not in the live ticker set) added
 * alongside it later — `metaByTicker`, the older of the two sibling per-ticker records, never got
 * the same treatment. This helper is shared by both so they can't drift apart again.
 */
export function pruneStaleTickerEntries<T>(
  entries: Readonly<Record<string, T>>,
  activeTickers: ReadonlySet<string>
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = { ...entries };
  for (const key of Object.keys(next)) {
    if (!activeTickers.has(key)) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : (entries as Record<string, T>);
}

/**
 * `pruneStaleTickerEntries`'s sibling for a `Map` — same same-reference-when-unchanged contract,
 * for callers that key per-ticker state by a `Map` rather than a plain `Record` (VectorCompareDesk's
 * `timelinesRef`, which tracks each pane's own replay timeline for the linked-replay scrubber).
 *
 * THE GAP THIS CLOSES (VectorCompareDesk's `timelinesRef`). `handleReplayTimeline` already pruned
 * stale keys out of `timelinesRef.current` — but only as a side effect of the NEXT call to
 * `handleReplayTimeline` for some OTHER ticker, which only fires again once that pane's chart
 * receives a new bar. Removing a pane (via `removeTicker` or a preset swap) did not itself prune
 * the ref. During live RTH with other panes still ticking, this self-healed within seconds — but
 * off-hours, with replay data static, or if the removed pane was the only one producing updates,
 * the stale timeline could sit in `timelinesRef.current` indefinitely, inflating `unionTimeline`
 * (and therefore the linked-replay scrubber's range) with steps belonging to a pane that's no
 * longer on screen. Mirrors the same fix already applied to `metaByTicker`/`playByTicker` via
 * `pruneStaleTickerEntries` above — this lets `timelinesRef` get the identical proactive,
 * `seeds`-keyed cleanup instead of waiting on an unrelated pane's next tick.
 */
export function pruneStaleTickerMapEntries<T>(
  entries: ReadonlyMap<string, T>,
  activeTickers: ReadonlySet<string>
): Map<string, T> {
  let changed = false;
  const next = new Map(entries);
  for (const key of next.keys()) {
    if (!activeTickers.has(key)) {
      next.delete(key);
      changed = true;
    }
  }
  return changed ? next : (entries as Map<string, T>);
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
