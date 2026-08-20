/**
 * Prefetch live desk data when a slash command sets desk scope — same cache readers as the UI.
 * Submodule-aware: narrows the prefetch payload to the active slice when possible.
 */

import type { DeskScopeKey, TurnSnapshot } from "@/lib/largo/desk-scope";
import { resolveSubmodule } from "@/lib/largo/slash-submodules";

export async function prefetchDeskScopeBlock(
  desk: DeskScopeKey,
  ticker: string,
  submoduleId?: string | null
): Promise<{ block: string; toolsUsed: string[] }> {
  const t = ticker.toUpperCase();
  const sub = resolveSubmodule(desk, submoduleId ?? "");
  const toolsUsed: string[] = [];
  const chunks: string[] = [];

  try {
    switch (desk) {
      case "spx-slayer": {
        const { marketPlatform } = await import("@/lib/platform");
        const subId = sub?.id;
        if (!subId) {
          const [play, gex] = await Promise.all([
            marketPlatform.spx.getSpxPlayState().catch(() => null),
            import("@/lib/largo/gex-heatmap-for-largo").then((m) => m.gexHeatmapForLargo("SPX")).catch(() => null),
          ]);
          toolsUsed.push("desk_prefetch_spx");
          chunks.push(JSON.stringify({ play, gex_summary: gex }, null, 0).slice(0, 5000));
        } else if (subId === "play" || subId === "gates") {
          const [play, structure] = await Promise.all([
            marketPlatform.spx.getSpxPlayState().catch(() => null),
            marketPlatform.spx.getSpxDeskSummary().catch(() => null),
          ]);
          toolsUsed.push("desk_prefetch_spx_play");
          chunks.push(
            JSON.stringify({ play, macro_events: (structure as { macro_events?: unknown })?.macro_events ?? [] }, null, 0).slice(0, 4500)
          );
        } else if (subId === "gex" || subId === "pin") {
          const gex = await import("@/lib/largo/gex-heatmap-for-largo")
            .then((m) => m.gexHeatmapForLargo("SPX"))
            .catch(() => null);
          toolsUsed.push("desk_prefetch_spx_gex");
          chunks.push(JSON.stringify({ gex_summary: gex }, null, 0).slice(0, 4000));
        } else if (subId === "technicals") {
          const gex = await import("@/lib/largo/gex-heatmap-for-largo")
            .then((m) => m.gexHeatmapForLargo("SPX"))
            .catch(() => null);
          toolsUsed.push("desk_prefetch_spx_technicals");
          chunks.push(JSON.stringify({ gex_summary: gex }, null, 0).slice(0, 4000));
        } else if (subId === "flow-gex") {
          const { flowBriefForLargo } = await import("@/lib/largo/product-reads");
          const [gex, brief] = await Promise.all([
            import("@/lib/largo/gex-heatmap-for-largo").then((m) => m.gexHeatmapForLargo("SPX")).catch(() => null),
            flowBriefForLargo().catch(() => null),
          ]);
          toolsUsed.push("desk_prefetch_spx_flow_gex");
          chunks.push(JSON.stringify({ gex_summary: gex, flow_brief: brief }, null, 0).slice(0, 4000));
        }
        break;
      }
      case "helix": {
        const { flowBriefForLargo, helixTapeAnalyticsForLargo } = await import("@/lib/largo/product-reads");
        const subId = sub?.id ?? "tape";
        if (subId === "tape" || subId === "tide" || !sub) {
          const brief = await flowBriefForLargo().catch(() => null);
          toolsUsed.push("desk_prefetch_helix_brief");
          chunks.push(JSON.stringify({ brief }, null, 0).slice(0, 3000));
        }
        if (subId === "whales" || subId === "strike-stack" || subId === "analytics" || subId === "tape" || !sub) {
          const analytics = await helixTapeAnalyticsForLargo(t === "SPX" ? null : t, 120).catch(() => null);
          toolsUsed.push("desk_prefetch_helix_analytics");
          chunks.push(JSON.stringify({ analytics }, null, 0).slice(0, 3000));
        }
        break;
      }
      case "thermal": {
        const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
        const subId = sub?.id ?? "positioning";
        if (subId === "positioning" || subId === "vex" || subId === "compare" || !sub) {
          const pos = await getGexPositioning(t).catch(() => null);
          toolsUsed.push("desk_prefetch_thermal_pos");
          chunks.push(JSON.stringify({ positioning: pos }, null, 0).slice(0, 4000));
        }
        if (subId === "matrix" || subId === "changes" || subId === "vex" || !sub) {
          const matrix = await import("@/lib/largo/gex-heatmap-for-largo")
            .then((m) => m.gexHeatmapForLargo(t))
            .catch(() => null);
          toolsUsed.push("desk_prefetch_thermal_matrix");
          chunks.push(JSON.stringify({ matrix }, null, 0).slice(0, 4000));
        }
        break;
      }
      case "vector": {
        const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
        const state = await fetchVectorFullState(t).catch(() => null);
        toolsUsed.push("desk_prefetch_vector");
        const subId = sub?.id;
        if (subId === "regime") {
          chunks.push(JSON.stringify({ regime: state?.regime, spot: state?.spot }, null, 0).slice(0, 2000));
        } else if (subId === "play") {
          chunks.push(JSON.stringify({ play: state?.play, spot: state?.spot }, null, 0).slice(0, 2000));
        } else {
          chunks.push(JSON.stringify({ vector: state }, null, 0).slice(0, 4000));
        }
        break;
      }
      case "nighthawk": {
        const zerodte = await import("@/lib/platform/zerodte-service")
          .then((m) => m.zeroDtePlaysForLargo())
          .catch(() => null);
        toolsUsed.push("desk_prefetch_nighthawk");
        const subId = sub?.id;
        const payload = zerodte as { plays?: unknown[] } | null;
        if (subId === "condor") {
          const condors = (payload?.plays ?? []).filter((p) =>
            /condor/i.test(JSON.stringify(p))
          );
          chunks.push(JSON.stringify({ condors }, null, 0).slice(0, 4000));
        } else if (subId === "marks") {
          chunks.push(JSON.stringify({ marks: payload?.plays }, null, 0).slice(0, 4000));
        } else {
          chunks.push(JSON.stringify({ zerodte: payload }, null, 0).slice(0, 4000));
        }
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
  const sliceLabel = sub ? `${desk}/${sub.id}` : desk;
  return {
    block: `\n\n## Desk prefetch (${sliceLabel} — cite these numbers)\n${chunks.join("\n")}\n`,
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
