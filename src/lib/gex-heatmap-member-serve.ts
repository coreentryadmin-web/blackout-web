import "server-only";

import {
  fetchGexHeatmap,
  readGexHeatmapSnapshot,
  type GexHeatmap,
} from "@/lib/providers/polygon-options-gex";
import { gexHeatmapMemberRouteDeadlineMs } from "@/lib/providers/config";
import {
  compactHeatmapMemberPayload,
  heatmapMemberUsable,
  type HeatmapMemberPayload,
} from "@/lib/gex-heatmap-member";
import { roundFloats, reconcileStrikeTotal, reconcileCellStrikeTotals } from "@/lib/round-floats";

/** Fire-and-forget matrix warm — member routes must never await cold builds. */
export function scheduleHeatmapBackgroundWarm(
  ticker: string,
  opts: { forceRefresh?: boolean } = {}
): void {
  void fetchGexHeatmap(ticker, { forceRefresh: opts.forceRefresh === true }).catch(() => undefined);
}

/**
 * Cache-reader member load: snapshot only unless `forceRefresh` (manual ↻).
 * Cold miss → background warm + null (never block on Polygon chain pagination).
 */
export async function loadHeatmapCacheReaderOnly(
  ticker: string,
  forceRefresh: boolean
): Promise<GexHeatmap | null> {
  if (!forceRefresh) {
    const snap = await readGexHeatmapSnapshot(ticker);
    if (snap) return snap;
    scheduleHeatmapBackgroundWarm(ticker);
    return null;
  }

  const deadlineMs = gexHeatmapMemberRouteDeadlineMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = fetchGexHeatmap(ticker, { forceRefresh: true });
  const timeout = new Promise<GexHeatmap | null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[gex-heatmap] ${ticker}: force refresh exceeded ${deadlineMs}ms — serving cached snapshot`
      );
      void readGexHeatmapSnapshot(ticker).then(resolve);
    }, deadlineMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Compare-grid wire payload — compact 0DTE band, rounded strike totals. */
export function buildCompactComparePayload(heatmap: GexHeatmap): HeatmapMemberPayload {
  const heatmapUsable = heatmap.spot > 0 && heatmap.strikes.length > 0;
  const rounded = roundFloats({
    available: heatmapUsable,
    ...heatmap,
  }) as HeatmapMemberPayload;

  if (rounded.gex) {
    rounded.gex = reconcileStrikeTotal(
      reconcileCellStrikeTotals(rounded.gex, rounded.near_term_expiries)
    )!;
  }
  if (rounded.vex) {
    rounded.vex = reconcileStrikeTotal(
      reconcileCellStrikeTotals(rounded.vex, rounded.near_term_expiries)
    )!;
  }
  if (rounded.dex) {
    rounded.dex = reconcileStrikeTotal(
      reconcileCellStrikeTotals(rounded.dex, rounded.near_term_expiries)
    );
  }
  if (rounded.charm) {
    rounded.charm = reconcileStrikeTotal(
      reconcileCellStrikeTotals(rounded.charm, rounded.near_term_expiries)
    );
  }

  return compactHeatmapMemberPayload(rounded);
}

export function memberPayloadFromHeatmap(
  heatmap: GexHeatmap | null
): HeatmapMemberPayload | null {
  if (!heatmap) return null;
  const payload = buildCompactComparePayload(heatmap);
  return heatmapMemberUsable(payload) ? payload : null;
}
