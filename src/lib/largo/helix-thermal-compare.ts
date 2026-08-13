/**
 * HELIX + Thermal side-by-side — deterministic parallel read, not model-merged prose.
 * Powers the compare card UI and the conflict chip on the status strip.
 */

import { roundFloats } from "@/lib/round-floats";

export type HelixThermalSide = {
  available: boolean;
  bias: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  summary: string;
  net_premium?: number | null;
  call_premium?: number | null;
  put_premium?: number | null;
  flip?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  spot?: number | null;
  gamma_regime?: string | null;
  print_count?: number | null;
};

export type HelixThermalCompareCard = {
  ticker: string;
  as_of: string;
  helix: HelixThermalSide;
  thermal: HelixThermalSide;
  /** True when flow bias and gamma regime point different directions. */
  conflict: boolean;
  conflict_note: string | null;
};

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

/** Run HELIX flow + Thermal GEX in parallel for one ticker (default SPX). */
export async function helixThermalCompareForLargo(ticker = "SPX"): Promise<HelixThermalCompareCard> {
  const t = String(ticker).trim().toUpperCase() || "SPX";
  const [{ marketPlatform }, { getGexPositioning }] = await Promise.all([
    import("@/lib/platform"),
    import("@/lib/providers/gex-positioning"),
  ]);

  const [flowRes, pos] = await Promise.all([
    marketPlatform.flows
      .getFlowTapeSummary({ limit: 50, ticker: t })
      .catch(() => null),
    getGexPositioning(t).catch(() => null),
  ]);

  const recent = (flowRes as { recent?: Array<{ ticker?: string; premium?: number; option_type?: string }> } | null)
    ?.recent;
  const scoped = Array.isArray(recent)
    ? recent.filter((r) => String(r.ticker ?? t).toUpperCase().startsWith(t.slice(0, 3)))
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
  const helixSummary =
    flowBias === "bullish"
      ? "Net call premium leads on the tape"
      : flowBias === "bearish"
        ? "Net put premium leads on the tape"
        : flowBias === "neutral"
          ? "Flow is balanced call vs put"
          : "Insufficient flow in window";

  const gammaRegime = pos?.gamma_regime_read ?? null;
  const thermalBias = thermalBiasFromRegime(gammaRegime);
  const thermalSummary =
    gammaRegime != null && String(gammaRegime).trim()
      ? String(gammaRegime)
      : pos?.flip != null
        ? `Flip ${pos.flip}`
        : "Positioning unavailable";

  const conflict = biasesConflict(flowBias, thermalBias);
  const conflictNote = conflict
    ? `HELIX flow reads ${flowBias} while Thermal gamma reads ${thermalBias}`
    : null;

  return roundFloats({
    ticker: t,
    as_of: new Date().toISOString(),
    helix: {
      available: flowRes != null,
      bias: flowBias,
      summary: helixSummary,
      net_premium: callPrem - putPrem,
      call_premium: callPrem || null,
      put_premium: putPrem || null,
      print_count: scoped.length || (recent?.length ?? 0) || null,
    },
    thermal: {
      available: pos != null,
      bias: thermalBias,
      summary: thermalSummary,
      flip: pos?.flip ?? null,
      call_wall: pos?.call_wall ?? null,
      put_wall: pos?.put_wall ?? null,
      spot: pos?.spot ?? null,
      gamma_regime: gammaRegime != null ? String(gammaRegime) : null,
    },
    conflict,
    conflict_note: conflictNote,
  });
}
