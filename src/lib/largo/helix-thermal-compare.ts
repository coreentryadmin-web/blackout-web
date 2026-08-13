/**
 * HELIX + Thermal side-by-side — deterministic parallel read, not model-merged prose.
 * Powers the compare card UI and the conflict chip on the status strip.
 *
 * Two card modes:
 * - `helix_thermal` — one ticker, HELIX flow vs Thermal gamma (SPX default)
 * - `peer_tickers` — 2–3 tickers, flow + gamma per name (earnings / peer days)
 */

import { roundFloats } from "@/lib/round-floats";

// Shapes and guards live in the CLIENT-SAFE module — see compare-card-types.ts for why a client
// component importing them from HERE breaks the webpack build. Re-exported so existing server
// callers keep their import paths unchanged.
import {
  DEFAULT_PEER_COMPARE_TICKERS,
  type LargoCompareCard,
  type HelixThermalCompareCard,
  type HelixThermalSide,
  type PeerTickerCompareCard,
  type PeerTickerRow,
} from "@/lib/largo/compare-card-types";

export type {
  HelixThermalSide,
  HelixThermalCompareCard,
  PeerTickerRow,
  PeerTickerCompareCard,
  LargoCompareCard,
} from "@/lib/largo/compare-card-types";
export {
  DEFAULT_PEER_COMPARE_TICKERS,
  isHelixThermalCompareCard,
  isPeerTickerCompareCard,
} from "@/lib/largo/compare-card-types";

function flowBiasFromPremiums(
  call: number | null | undefined,
  put: number | null | undefined
): HelixThermalSide["bias"] {
  const c = typeof call === "number" && Number.isFinite(call) ? call : 0;
  const p = typeof put === "number" && Number.isFinite(put) ? put : 0;
  const net = c - p;
  const total = c + p;
  if (total < 1) return "unknown";
  const ratio = net / total;
  if (ratio > 0.15) return "bullish";
  if (ratio < -0.15) return "bearish";
  return "neutral";
}

function thermalBiasFromRegime(regime: string | null | undefined): HelixThermalSide["bias"] {
  const r = String(regime ?? "").toLowerCase();
  if (!r) return "unknown";
  if (/positive|long gamma|support|pin/i.test(r)) return "bullish";
  if (/negative|short gamma|volatility|break/i.test(r)) return "bearish";
  if (/mixed|neutral|trans/i.test(r)) return "mixed";
  return "neutral";
}

function biasesConflict(a: HelixThermalSide["bias"], b: HelixThermalSide["bias"]): boolean {
  const bull = new Set<HelixThermalSide["bias"]>(["bullish"]);
  const bear = new Set<HelixThermalSide["bias"]>(["bearish"]);
  return (bull.has(a) && bear.has(b)) || (bear.has(a) && bull.has(b));
}

function flowSummary(bias: HelixThermalSide["bias"]): string {
  if (bias === "bullish") return "Net call premium leads on the tape";
  if (bias === "bearish") return "Net put premium leads on the tape";
  if (bias === "neutral") return "Flow is balanced call vs put";
  return "Insufficient flow in window";
}

function gammaSummary(gammaRegime: string | null, flip: number | null | undefined): string {
  if (gammaRegime != null && String(gammaRegime).trim()) return String(gammaRegime);
  if (flip != null) return `Flip ${flip}`;
  return "Positioning unavailable";
}

type FlowTapeRow = { ticker?: string; premium?: number; option_type?: string };

async function fetchTickerFlowAndGamma(ticker: string): Promise<{
  flow: HelixThermalSide;
  gamma: HelixThermalSide;
  conflict: boolean;
  conflict_note: string | null;
}> {
  const t = String(ticker).trim().toUpperCase();
  const [{ marketPlatform }, { getGexPositioning }] = await Promise.all([
    import("@/lib/platform"),
    import("@/lib/providers/gex-positioning"),
  ]);

  const [flowRes, pos] = await Promise.all([
    marketPlatform.flows.getFlowTapeSummary({ limit: 50, ticker: t }).catch(() => null),
    getGexPositioning(t).catch(() => null),
  ]);

  const recent = (flowRes as { recent?: FlowTapeRow[] } | null)?.recent;
  const prefix = t.slice(0, Math.min(4, t.length));
  const scoped = Array.isArray(recent)
    ? recent.filter((r) => String(r.ticker ?? t).toUpperCase().startsWith(prefix))
    : [];
  let callPrem = 0;
  let putPrem = 0;
  for (const row of scoped.length ? scoped : recent ?? []) {
    const prem = Number(row.premium ?? 0);
    if (!Number.isFinite(prem)) continue;
    if (/call/i.test(String(row.option_type ?? ""))) callPrem += prem;
    else if (/put/i.test(String(row.option_type ?? ""))) putPrem += prem;
  }

  const flowBias = flowBiasFromPremiums(callPrem, putPrem);
  const gammaRegime = pos?.gamma_regime_read ?? null;
  const gammaBias = thermalBiasFromRegime(gammaRegime);
  const conflict = biasesConflict(flowBias, gammaBias);
  const conflictNote = conflict
    ? `Flow reads ${flowBias} while gamma reads ${gammaBias}`
    : null;

  return {
    flow: {
      available: flowRes != null,
      bias: flowBias,
      summary: flowSummary(flowBias),
      net_premium: callPrem - putPrem,
      call_premium: callPrem || null,
      put_premium: putPrem || null,
      print_count: scoped.length || (recent?.length ?? 0) || null,
    },
    gamma: {
      available: pos != null,
      bias: gammaBias,
      summary: gammaSummary(gammaRegime != null ? String(gammaRegime) : null, pos?.flip),
      flip: pos?.flip ?? null,
      call_wall: pos?.call_wall ?? null,
      put_wall: pos?.put_wall ?? null,
      spot: pos?.spot ?? null,
      gamma_regime: gammaRegime != null ? String(gammaRegime) : null,
    },
    conflict,
    conflict_note: conflictNote,
  };
}

/** Run HELIX flow + Thermal GEX in parallel for one ticker (default SPX). */
export async function helixThermalCompareForLargo(ticker = "SPX"): Promise<HelixThermalCompareCard> {
  const t = String(ticker).trim().toUpperCase() || "SPX";
  const { flow, gamma, conflict, conflict_note } = await fetchTickerFlowAndGamma(t);

  const conflictNote = conflict
    ? `HELIX flow reads ${flow.bias} while Thermal gamma reads ${gamma.bias}`
    : conflict_note;

  return roundFloats({
    kind: "helix_thermal",
    ticker: t,
    as_of: new Date().toISOString(),
    helix: flow,
    thermal: gamma,
    conflict,
    conflict_note: conflictNote,
  });
}

/** Flow + gamma side-by-side for 2–3 peer tickers (earnings / sector days). */
export async function peerTickerCompareForLargo(
  tickers: readonly string[]
): Promise<PeerTickerCompareCard> {
  const normalized = [...new Set(tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean))].slice(
    0,
    3
  );
  const list = normalized.length >= 2 ? normalized : [...DEFAULT_PEER_COMPARE_TICKERS];

  const snapshots = await Promise.all(
    list.map(async (ticker) => {
      const snap = await fetchTickerFlowAndGamma(ticker).catch(() => null);
      return { ticker, snap };
    })
  );

  const rows: PeerTickerRow[] = snapshots.map(({ ticker, snap }) => {
    if (!snap) {
      return {
        ticker,
        flow: { available: false, bias: "unknown", summary: "Flow unavailable" },
        gamma: { available: false, bias: "unknown", summary: "Positioning unavailable" },
        conflict: false,
        conflict_note: null,
      };
    }
    return {
      ticker,
      flow: snap.flow,
      gamma: snap.gamma,
      conflict: snap.conflict,
      conflict_note: snap.conflict_note,
    };
  });

  const flowBiases = rows.map((r) => r.flow.bias).filter((b) => b !== "unknown");
  const uniqueFlow = new Set(flowBiases.filter((b) => b === "bullish" || b === "bearish"));
  const peerDivergence = uniqueFlow.size >= 2;
  const peerDivergenceNote = peerDivergence
    ? `Peer flow diverges — ${rows.map((r) => `${r.ticker} ${r.flow.bias}`).join(", ")}`
    : null;

  return roundFloats({
    kind: "peer_tickers",
    tickers: list,
    as_of: new Date().toISOString(),
    rows,
    peer_divergence: peerDivergence,
    peer_divergence_note: peerDivergenceNote,
  });
}
