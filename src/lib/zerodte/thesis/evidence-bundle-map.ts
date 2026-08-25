import type { LegacyBridgeExtras } from "./rails/legacy-bridge";

/** Per-ticker cache-backed evidence for thesis rails (no provider calls in mapper). */
export type ThesisEvidenceSnapshot = {
  thermal: {
    gamma_posture: "long" | "short" | null;
    call_wall: number | null;
    put_wall: number | null;
    gex_king_strike: number | null;
    cross_validation_divergence: number | null;
  } | null;
  vector: {
    resistance: number | null;
    support: number | null;
    bead_wall_near_spot: number | null;
    expected_move_pct: number | null;
    dark_pool_bias: "bullish" | "bearish" | "mixed" | null;
  } | null;
};

export function thesisEvidenceToLegacyExtras(ev: ThesisEvidenceSnapshot): LegacyBridgeExtras {
  const out: LegacyBridgeExtras = {};
  if (ev.thermal) {
    out.gamma_posture = ev.thermal.gamma_posture;
    out.call_wall = ev.thermal.call_wall;
    out.put_wall = ev.thermal.put_wall;
  }
  if (ev.vector) {
    if (ev.vector.resistance != null) out.resistance = ev.vector.resistance;
    if (ev.vector.support != null) out.support = ev.vector.support;
    out.bead_wall_near_spot = ev.vector.bead_wall_near_spot;
    out.expected_move_pct = ev.vector.expected_move_pct;
    out.dark_pool_bias = ev.vector.dark_pool_bias;
  }
  return out;
}

export function mergeLegacyBridgeExtras(
  base: LegacyBridgeExtras,
  overlay: LegacyBridgeExtras
): LegacyBridgeExtras {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(overlay).filter(([, v]) => v != null && v !== undefined)
    ),
  };
}
