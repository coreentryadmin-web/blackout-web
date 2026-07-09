import type {
  GexFlowByStrike,
  GexDarkPoolLevel,
  GexHeatmapOverlays,
} from "@/lib/providers/polygon-options-gex";
import { fetchUwFlowPerStrikeRows, fetchUwDarkPool } from "@/lib/providers/unusual-whales";
import { isUwCircuitOpen } from "@/lib/providers/uw-rate-limiter";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { isHeatmapOverlayAllowed } from "@/lib/heatmap-allowlist";

const OVERLAY_TTL_MS = 30_000;
const overlayMem = new Map<string, { at: number; overlays: GexHeatmapOverlays }>();

const NO_OVERLAYS: GexHeatmapOverlays = { flow_by_strike: null, dark_pool_levels: null };

async function buildFlowByStrike(
  ticker: string,
  strikes: number[]
): Promise<Record<string, GexFlowByStrike> | null> {
  if (!strikes.length) return null;
  try {
    const rows = await fetchUwFlowPerStrikeRows(ticker, 250);
    if (!rows.length) return null;

    const strikeSet = new Set(strikes.map((s) => String(s)));
    const byStrike: Record<string, GexFlowByStrike> = {};
    for (const row of rows) {
      const strikeRaw = Number(row.strike ?? row.strike_price);
      if (!Number.isFinite(strikeRaw) || strikeRaw <= 0) continue;
      const key = strikeSet.has(String(strikeRaw))
        ? String(strikeRaw)
        : strikeSet.has(String(Math.round(strikeRaw)))
          ? String(Math.round(strikeRaw))
          : null;
      if (!key) continue;

      const callPrem = Number(row.call_premium ?? 0);
      const putPrem = Number(row.put_premium ?? 0);
      if (!Number.isFinite(callPrem) || !Number.isFinite(putPrem)) continue;
      if (callPrem === 0 && putPrem === 0) continue;

      const prev = byStrike[key] ?? { call_prem: 0, put_prem: 0, net_prem: 0 };
      const call_prem = prev.call_prem + callPrem;
      const put_prem = prev.put_prem + putPrem;
      byStrike[key] = { call_prem, put_prem, net_prem: call_prem - put_prem };
    }
    return Object.keys(byStrike).length ? byStrike : null;
  } catch (err) {
    console.warn(
      `[gex-overlay] flow-per-strike skipped for ${ticker}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

async function buildDarkPoolLevels(ticker: string): Promise<GexDarkPoolLevel[] | null> {
  try {
    const snapshot = await fetchUwDarkPool(ticker, { limit: 50 });
    if (!snapshot || !snapshot.prints.length) return null;

    const byLevel = new Map<number, number>();
    for (const print of snapshot.prints) {
      const price = Number(print.strike);
      const notional = Number(print.premium);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!Number.isFinite(notional) || notional <= 0) continue;
      byLevel.set(price, (byLevel.get(price) ?? 0) + notional);
    }
    if (!byLevel.size) return null;

    const levels: GexDarkPoolLevel[] = Array.from(byLevel.entries())
      .map(([price, notional]) => ({ price, notional }))
      .sort((a, b) => b.notional - a.notional)
      .slice(0, 5);
    return levels.length ? levels : null;
  } catch (err) {
    console.warn(
      `[gex-overlay] dark-pool skipped for ${ticker}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** Cached overlay enrichment — one upstream fetch per ticker per TTL, shared across all users. */
export async function getGexOverlays(
  ticker: string,
  strikes: number[]
): Promise<{ overlays: GexHeatmapOverlays; at: number | null }> {
  const now = Date.now();
  const mem = overlayMem.get(ticker);
  if (mem && now - mem.at < OVERLAY_TTL_MS) return { overlays: mem.overlays, at: mem.at };

  try {
    const hit = await sharedCacheGet<{ at: number; overlays: GexHeatmapOverlays }>(
      `gex-overlay:${ticker}`
    );
    if (hit && now - hit.at < OVERLAY_TTL_MS) {
      overlayMem.set(ticker, hit);
      return { overlays: hit.overlays, at: hit.at };
    }
  } catch {
    /* redis optional */
  }

  if (!isHeatmapOverlayAllowed(ticker)) return { overlays: NO_OVERLAYS, at: null };
  if (isUwCircuitOpen()) return { overlays: NO_OVERLAYS, at: null };

  const [flow_by_strike, dark_pool_levels] = await Promise.all([
    buildFlowByStrike(ticker, strikes),
    buildDarkPoolLevels(ticker),
  ]);
  const overlays: GexHeatmapOverlays = { flow_by_strike, dark_pool_levels };
  const entry = { at: now, overlays };
  if (overlayMem.size > 200) overlayMem.clear();
  overlayMem.set(ticker, entry);
  void sharedCacheSet(`gex-overlay:${ticker}`, entry, Math.ceil(OVERLAY_TTL_MS / 1000)).catch(
    () => {}
  );
  return { overlays, at: now };
}

/** Cron warm: prime UW overlays after the matrix cache is hot. */
export async function primeGexOverlays(ticker: string, strikes: number[]): Promise<void> {
  if (!isHeatmapOverlayAllowed(ticker) || !strikes.length) return;
  if (isUwCircuitOpen()) return;
  await getGexOverlays(ticker, strikes);
}
