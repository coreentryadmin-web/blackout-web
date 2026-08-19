/**
 * Prefetch live desk data when a slash command sets desk scope — same cache readers as the UI.
 */

import type { DeskScopeKey, TurnSnapshot } from "@/lib/largo/desk-scope";

export async function prefetchDeskScopeBlock(
  desk: DeskScopeKey,
  ticker: string
): Promise<{ block: string; toolsUsed: string[] }> {
  const t = ticker.toUpperCase();
  const toolsUsed: string[] = [];
  const chunks: string[] = [];

  try {
    switch (desk) {
      case "spx-slayer": {
        const { marketPlatform } = await import("@/lib/platform");
        const [play, gex] = await Promise.all([
          marketPlatform.spx.getSpxPlayState().catch(() => null),
          import("@/lib/largo/gex-heatmap-for-largo").then((m) => m.gexHeatmapForLargo("SPX")).catch(() => null),
        ]);
        toolsUsed.push("desk_prefetch_spx");
        chunks.push(JSON.stringify({ play, gex_summary: gex }, null, 0).slice(0, 5000));
        break;
      }
      case "helix": {
        const { flowBriefForLargo, helixTapeAnalyticsForLargo } = await import("@/lib/largo/product-reads");
        const [brief, analytics] = await Promise.all([
          flowBriefForLargo(),
          helixTapeAnalyticsForLargo(t === "SPX" ? null : t, 120),
        ]);
        toolsUsed.push("desk_prefetch_helix");
        chunks.push(JSON.stringify({ brief, analytics }, null, 0).slice(0, 5000));
        break;
      }
      case "thermal": {
        const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
        const pos = await getGexPositioning(t).catch(() => null);
        toolsUsed.push("desk_prefetch_thermal");
        chunks.push(JSON.stringify({ positioning: pos }, null, 0).slice(0, 4000));
        break;
      }
      case "vector": {
        const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
        const state = await fetchVectorFullState(t).catch(() => null);
        toolsUsed.push("desk_prefetch_vector");
        chunks.push(JSON.stringify({ vector: state }, null, 0).slice(0, 4000));
        break;
      }
      case "nighthawk": {
        const zerodte = await import("@/lib/platform/zerodte-service").then((m) => m.zeroDtePlaysForLargo()).catch(() => null);
        toolsUsed.push("desk_prefetch_nighthawk");
        chunks.push(JSON.stringify({ zerodte }, null, 0).slice(0, 4000));
        break;
      }
      case "meridian": {
        const { meridianTimelineForLargo } = await import("@/lib/largo/meridian-for-largo");
        const timeline = await meridianTimelineForLargo(7).catch(() => null);
        toolsUsed.push("desk_prefetch_meridian");
        chunks.push(JSON.stringify({ meridian: timeline }, null, 0).slice(0, 4000));
        break;
      }
      default:
        break;
    }
  } catch {
    return { block: "", toolsUsed: [] };
  }

  if (!chunks.length) return { block: "", toolsUsed: [] };
  return {
    block: `\n\n## Desk prefetch (${desk} — cite these numbers)\n${chunks.join("\n")}\n`,
    toolsUsed,
  };
}

/** Build a turn snapshot for /diff from prefetched positioning + flow. */
export async function buildTurnSnapshot(input: {
  ticker: string;
  deskScope?: string | null;
}): Promise<TurnSnapshot> {
  const t = input.ticker.toUpperCase();
  const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
  const { marketPlatform } = await import("@/lib/platform");

  const [pos, flows] = await Promise.all([
    getGexPositioning(t).catch(() => null),
    marketPlatform.flows.getFlowTapeSummary({ limit: 50, ticker: t }).catch(() => null),
  ]);

  const recent = (flows as { recent?: Array<{ premium?: number; option_type?: string }> } | null)?.recent ?? [];
  let net = 0;
  for (const p of recent) {
    const prem = Number(p.premium ?? 0);
    if (p.option_type === "CALL") net += prem;
    else if (p.option_type === "PUT") net -= prem;
  }

  return {
    as_of: new Date().toISOString(),
    ticker: t,
    desk_scope: input.deskScope ?? null,
    spot: pos?.spot ?? null,
    flip: pos?.flip ?? null,
    call_wall: pos?.call_wall ?? null,
    put_wall: pos?.put_wall ?? null,
    net_premium: recent.length ? net : null,
  };
}
