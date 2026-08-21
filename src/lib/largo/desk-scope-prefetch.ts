/**
 * Prefetch live desk data when a slash command sets desk scope — same cache readers as the UI.
 * Submodule-aware: narrows the prefetch payload to the active slice when possible.
 */

import type { DeskScopeKey, TurnSnapshot } from "@/lib/largo/desk-scope";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";
import { resolveSubmodule } from "@/lib/largo/slash-submodules";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";

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
        const productReads = await import("@/lib/largo/product-reads");
        const subId = sub?.id;
        if (!subId) {
          const [play, gex, pin, pulse] = await Promise.all([
            marketPlatform.spx.getSpxPlayState().catch(() => null),
            import("@/lib/largo/gex-heatmap-for-largo").then((m) => m.gexHeatmapForLargo("SPX")).catch(() => null),
            productReads.spxPinForLargo().catch(() => null),
            productReads.spxPulseForLargo().catch(() => null),
          ]);
          toolsUsed.push("desk_prefetch_spx");
          chunks.push(JSON.stringify({ play, gex_summary: gex, pin, pulse }, null, 0).slice(0, 5000));
        } else if (subId === "play" || subId === "gates") {
          const [play, structure] = await Promise.all([
            marketPlatform.spx.getSpxPlayState().catch(() => null),
            marketPlatform.spx.getSpxDeskSummary().catch(() => null),
          ]);
          toolsUsed.push("desk_prefetch_spx_play");
          chunks.push(
            JSON.stringify({ play, macro_events: (structure as { macro_events?: unknown })?.macro_events ?? [] }, null, 0).slice(0, 4500)
          );
        } else if (subId === "gex") {
          const gex = await import("@/lib/largo/gex-heatmap-for-largo")
            .then((m) => m.gexHeatmapForLargo("SPX"))
            .catch(() => null);
          toolsUsed.push("desk_prefetch_spx_gex");
          chunks.push(JSON.stringify({ gex_summary: gex }, null, 0).slice(0, 4000));
        } else if (subId === "pin") {
          const [pin, gex] = await Promise.all([
            productReads.spxPinForLargo().catch(() => null),
            import("@/lib/largo/gex-heatmap-for-largo").then((m) => m.gexHeatmapForLargo("SPX")).catch(() => null),
          ]);
          toolsUsed.push("desk_prefetch_spx_pin");
          chunks.push(JSON.stringify({ pin_forecast: pin, gex_summary: gex }, null, 0).slice(0, 4000));
        } else if (subId === "pulse") {
          const pulse = await productReads.spxPulseForLargo().catch(() => null);
          toolsUsed.push("desk_prefetch_spx_pulse");
          chunks.push(JSON.stringify({ pulse }, null, 0).slice(0, 4000));
        } else if (subId === "technicals" || subId === "internals") {
          const structure = await marketPlatform.spx.getSpxDeskSummary().catch(() => null);
          toolsUsed.push("desk_prefetch_spx_technicals");
          const s = structure as {
            vwap?: number;
            ema20?: number;
            ema50?: number;
            ema200?: number;
            tick?: number;
            trin?: number;
            add?: number;
            price?: number;
            above_vwap?: boolean;
          } | null;
          chunks.push(
            JSON.stringify(
              subId === "internals"
                ? { tick: s?.tick, trin: s?.trin, add: s?.add, price: s?.price }
                : {
                    vwap: s?.vwap,
                    ema20: s?.ema20,
                    ema50: s?.ema50,
                    ema200: s?.ema200,
                    price: s?.price,
                    above_vwap: s?.above_vwap,
                  },
              null,
              0
            ).slice(0, 4000)
          );
        } else if (subId === "lotto") {
          const [lotto, play] = await Promise.all([
            marketPlatform.spx.getSpxLottoState().catch(() => null),
            marketPlatform.spx.getSpxPlayState().catch(() => null),
          ]);
          toolsUsed.push("desk_prefetch_spx_lotto");
          chunks.push(JSON.stringify({ lotto, play_engine: play }, null, 0).slice(0, 4000));
        } else if (subId === "power-hour") {
          const ph = await marketPlatform.spx.getSpxPowerHourState().catch(() => null);
          toolsUsed.push("desk_prefetch_spx_power_hour");
          chunks.push(JSON.stringify({ power_hour: ph }, null, 0).slice(0, 4000));
        } else if (subId === "signal-log") {
          const log = await marketPlatform.spx.getSpxSignalLog(15).catch(() => null);
          toolsUsed.push("desk_prefetch_spx_signal_log");
          chunks.push(JSON.stringify({ signal_log: log }, null, 0).slice(0, 4000));
        } else if (subId === "engine-history") {
          const snaps = await marketPlatform.spx.getSpxEngineSnapshots(15).catch(() => null);
          toolsUsed.push("desk_prefetch_spx_engine_history");
          chunks.push(JSON.stringify({ engine_snapshots: snaps }, null, 0).slice(0, 4000));
        } else if (subId === "record") {
          const [stats, history] = await Promise.all([
            marketPlatform.spx.getSpxSetupStats().catch(() => null),
            marketPlatform.spx.getSpxTradeHistory({ days: 30 }).catch(() => null),
          ]);
          toolsUsed.push("desk_prefetch_spx_record");
          chunks.push(JSON.stringify({ setup_stats: stats, trade_history: history }, null, 0).slice(0, 4000));
        } else if (subId === "vector") {
          const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
          const vector = await fetchVectorFullState("SPX").catch(() => null);
          toolsUsed.push("desk_prefetch_spx_vector");
          chunks.push(JSON.stringify({ vector }, null, 0).slice(0, 4000));
        } else if (subId === "flow-gex") {
          const { flowBriefForLargo } = await import("@/lib/largo/product-reads");
          const { helixThermalCompareForLargo } = await import("@/lib/largo/helix-thermal-compare");
          const [gex, brief, compare] = await Promise.all([
            import("@/lib/largo/gex-heatmap-for-largo").then((m) => m.gexHeatmapForLargo("SPX")).catch(() => null),
            flowBriefForLargo().catch(() => null),
            helixThermalCompareForLargo("SPX").catch(() => null),
          ]);
          toolsUsed.push("desk_prefetch_spx_flow_gex");
          chunks.push(JSON.stringify({ gex_summary: gex, flow_brief: brief, thermal_compare: compare }, null, 0).slice(0, 4000));
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

  const nowMs = Date.now();
  return {
    // ET-anchored, not UTC. This block is injected as desk context and formatDiffBlock renders it
    // straight into the prompt, and a UTC calendar date rolls at 20:00 ET — so the last four hours
    // of every session would be narrated under tomorrow's date. The measured failure: the model
    // concluded the current session was the NEXT calendar day and invented a "prior close" for the
    // session that had just ended. See largo-live-feed.ts.
    //
    // `?? new Date(nowMs).toISOString()` is unreachable in practice (nowMs is always a finite
    // epoch) and exists only to keep the field non-nullable for the declared type — a null here
    // would be worse than a UTC stamp, because an absent `as_of` reads as "no time at all".
    as_of: etStamp(nowMs) ?? new Date(nowMs).toISOString(),
    session_date: etSessionDate(nowMs),
    // WHICH MATRIX the levels below came from. Without it two turns 90 seconds apart can hold
    // byte-identical positioning off ONE cached matrix while the diff block presents them as a
    // before/after across a real interval — see formatDiffBlock.
    matrix_asof: pos?.asof ?? null,
    ticker: t,
    desk_scope: input.deskScope ?? null,
    spot: pos?.spot ?? null,
    flip: pos?.flip ?? null,
    call_wall: pos?.call_wall ?? null,
    put_wall: pos?.put_wall ?? null,
    net_premium: recent.length ? net : null,
  };
}
