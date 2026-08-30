import "server-only";

import { preEarningsPackForLargo } from "@/lib/largo/pre-earnings-pack";
import { loadMeridianEarningsEnrichment } from "@/lib/meridian/meridian-earnings-enrich";
import {
  loadMeridianEarningsIntel,
  type MeridianEarningsIntelPrefetch,
} from "@/lib/meridian/meridian-earnings-intel";
import { flowWindowHours } from "@/lib/meridian/meridian-earnings-intel-core";
import { fetchVectorFullState } from "@/lib/bie/vector-full-state";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { fetchTickerFundamentalsBundle } from "@/lib/bie/ticker-fundamentals";
import { getVectorExpectedMove } from "@/features/vector/lib/vector-expected-move-server";
import { fetchUwDarkPool } from "@/lib/providers/unusual-whales";
import { daysUntilEt } from "@/features/meridian/lib/meridian-timeline";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { roundFloats } from "@/lib/round-floats";
import { recordMeridianReportSnapshot, readMeridianReportSnapshots } from "@/lib/db";
import type {
  MeridianEarningsDetail,
} from "@/features/meridian/lib/meridian-types";

/**
 * Earnings event detail — parallel fan-out instead of pack → enrichment → intel waterfall.
 *
 * Cold path was ~8–9s on prod (2026-08-19): each stage re-fetched Benzinga, history, GEX, and
 * flow independently. Overlap the independent legs and share one GEX heatmap fetch for intel.
 */
export async function loadMeridianEarningsEventDetail(
  ticker: string,
  eventDate: string
): Promise<MeridianEarningsDetail | null> {
  const sym = ticker.trim().toUpperCase();
  if (!sym) return null;

  const daysUntil = daysUntilEt(eventDate, todayEtYmd());
  const windowHours = flowWindowHours(daysUntil);

  // One heatmap fetch for thermal + expiry-scoped structure (intel used to call twice).
  const rawHeatmapPromise = fetchGexHeatmap(sym).catch(() => null);

  const intelPrefetchBase: MeridianEarningsIntelPrefetch = {
    fundamentals: null,
    vectorEm: null,
    vectorFullState: null,
    darkPoolRaw: null,
    rawHeatmap: null,
    windowHours,
  };

  const [pack, enrichment, fundamentals, vectorEm, vectorFullState, darkPoolRaw, rawHeatmap] =
    await Promise.all([
    preEarningsPackForLargo(sym, eventDate),
    loadMeridianEarningsEnrichment(sym, null, eventDate),
    fetchTickerFundamentalsBundle(sym).catch(() => null),
    getVectorExpectedMove(sym, "weekly").catch(() => null),
    fetchVectorFullState(sym, "weekly").catch(() => null),
    fetchUwDarkPool(sym, { limit: 20 }).catch(() => null),
    rawHeatmapPromise,
  ]);

  if (!pack) return null;

  const intelPrefetch: MeridianEarningsIntelPrefetch = {
    ...intelPrefetchBase,
    fundamentals,
    vectorEm,
    vectorFullState,
    darkPoolRaw,
    rawHeatmap,
  };

  const [intel, drift_snapshots] = await Promise.all([
    loadMeridianEarningsIntel({
      ticker: sym,
      pack,
      print_history: enrichment.print_history,
      enrichment,
      prefetch: intelPrefetch,
    }),
    readMeridianReportSnapshots(sym, eventDate, 30),
  ]);

  const detail = roundFloats({
    kind: "earnings" as const,
    pack,
    enrichment,
    intel,
    drift_snapshots,
  });

  void recordMeridianReportSnapshot({
    ticker: sym,
    eventDate,
    snapshotDay: todayEtYmd(),
    score: intel?.report?.score ?? null,
    verdict: intel?.report?.verdict ?? null,
    confidence: intel?.report?.confidence ?? null,
    pillars: Object.fromEntries(
      (intel?.report?.signals ?? [])
        .filter((sig) => sig?.pillar && sig?.lean)
        .map((sig) => [String(sig.pillar), String(sig.lean)])
    ),
  }).catch(() => {});

  return detail;
}
