/**
 * Client-side warm-start for the Thermal compare grid — one batch cache-reader GET seeds
 * sessionStorage so SWR fallbackData paints every column together on open.
 */
import { isUsableGexHeatmapPayload } from "@/features/thermal/lib/thermal-desk-state";
import {
  readGexHeatmapSessionCache,
  writeGexHeatmapSessionCache,
} from "@/lib/gex-heatmap-session-cache";

type BatchPayload = {
  tickers?: Record<string, unknown>;
};

export async function fetchGexHeatmapForPrefetch(
  ticker: string,
  signal?: AbortSignal
): Promise<unknown | null> {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  const res = await fetch(`/api/market/gex-heatmap?ticker=${encodeURIComponent(t)}&compact=1`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    signal,
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchGexHeatmapBatchForPrefetch(
  tickers: readonly string[],
  signal?: AbortSignal
): Promise<BatchPayload | null> {
  if (!tickers.length) return null;
  const res = await fetch(
    `/api/market/gex-heatmap/batch?tickers=${encodeURIComponent(tickers.join(","))}&compact=1`,
    {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      signal,
    }
  );
  if (!res.ok) return null;
  return res.json();
}

/**
 * The batch currently in flight. Each call supersedes the previous one.
 *
 * WHY: the sector picker offers 10 presets of 3–7 names each, and a member scanning the dropdown
 * changes preset far faster than a heatmap build completes. Without this, every superseded preset
 * keeps its requests running to completion AND still writes sessionStorage on arrival — so a
 * member who lands on Energy can have Semis/AI/Space payloads overwrite the cache behind them, and
 * the server eats concurrent cold chain builds for one member's dropdown scroll. Abort on
 * supersede: only the preset actually being looked at gets to spend the budget or seed a cell.
 */
let inFlight: AbortController | null = null;

function seedBatchCache(payload: BatchPayload | null): void {
  if (!payload?.tickers) return;
  for (const [ticker, heatmap] of Object.entries(payload.tickers)) {
    if (isUsableGexHeatmapPayload(heatmap as Parameters<typeof isUsableGexHeatmapPayload>[0])) {
      writeGexHeatmapSessionCache(ticker, heatmap);
    }
  }
}

/** Fire-and-forget batch prefetch for compare-grid tickers. Supersedes any previous batch. */
export function prefetchGexHeatmapTickers(tickers: readonly string[]): void {
  if (typeof window === "undefined") return;

  const cold = tickers
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t && readGexHeatmapSessionCache(t) === undefined);
  if (!cold.length) return;

  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  void fetchGexHeatmapBatchForPrefetch(cold, controller.signal)
    .then((payload) => {
      if (controller.signal.aborted) return;
      seedBatchCache(payload);
    })
    .catch(() => {
      /* best-effort — AbortError is the intended path on supersede */
    });
}

/** Test seam: drop the in-flight batch reference between cases. */
export function __test_resetGexHeatmapPrefetch(): void {
  inFlight?.abort();
  inFlight = null;
}
