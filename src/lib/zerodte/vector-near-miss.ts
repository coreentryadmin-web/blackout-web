/**
 * Vector ↔ 0DTE near-miss read — names Vector is tracking as winner/runner
 * but 0DTE gate-blocked (SKIP). Calibration signal only; never commits.
 */
import type { ZeroDteVectorPulse } from "./vector-crosslink";

export type ZeroDteVectorNearMiss = {
  ticker: string;
  /** Primary gate that blocked the 0DTE commit. */
  block_code: string | null;
  block_label: string | null;
  block_reason: string | null;
  vector_premium_pct: number | null;
  vector_peak_pct: number | null;
  vector_band: "winner" | "runner" | "tracking";
};

type SetupSlice = {
  ticker?: string;
  gate?: {
    verdict?: string;
    blocks?: Array<{ code?: string; reason?: string }>;
  } | null;
};

/** Best live/peak % for display. */
function bestVectorPct(pulse: ZeroDteVectorPulse): number | null {
  const vals = [pulse.premium_pct, pulse.peak_premium_pct].filter(
    (n): n is number => n != null && Number.isFinite(n)
  );
  return vals.length > 0 ? Math.max(...vals) : null;
}

function vectorBand(pulse: ZeroDteVectorPulse): ZeroDteVectorNearMiss["vector_band"] {
  if (pulse.is_winner) return "winner";
  if (pulse.is_runner) return "runner";
  return "tracking";
}

/**
 * Gate-blocked setups where Vector shows meaningful positive drift today.
 * Sorted: winners first, then by best Vector %.
 */
export function computeVectorNearMisses(
  setups: readonly SetupSlice[],
  vectorByTicker: Record<string, ZeroDteVectorPulse>,
  gateLabel: (code: string) => string
): ZeroDteVectorNearMiss[] {
  const out: ZeroDteVectorNearMiss[] = [];
  for (const s of setups) {
    const tk = String(s.ticker ?? "").trim().toUpperCase();
    if (!tk || s.gate?.verdict !== "BLOCKED") continue;
    const pulse = vectorByTicker[tk];
    if (!pulse) continue;
    const best = bestVectorPct(pulse);
    if (!pulse.is_winner && !pulse.is_runner && (best == null || best < 15)) continue;
    const block = s.gate?.blocks?.[0];
    const code = block?.code ? String(block.code) : null;
    out.push({
      ticker: tk,
      block_code: code,
      block_label: code ? gateLabel(code) : null,
      block_reason: block?.reason ? String(block.reason) : null,
      vector_premium_pct: pulse.premium_pct,
      vector_peak_pct: pulse.peak_premium_pct,
      vector_band: vectorBand(pulse),
    });
  }
  out.sort((a, b) => {
    const bandRank = (x: ZeroDteVectorNearMiss) => (x.vector_band === "winner" ? 2 : x.vector_band === "runner" ? 1 : 0);
    const br = bandRank(b) - bandRank(a);
    if (br !== 0) return br;
    const ap = Math.max(a.vector_premium_pct ?? -999, a.vector_peak_pct ?? -999);
    const bp = Math.max(b.vector_premium_pct ?? -999, b.vector_peak_pct ?? -999);
    return bp - ap;
  });
  return out;
}
