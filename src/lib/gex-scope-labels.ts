import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { dteHorizonLabel } from "@/features/vector/lib/vector-dte-horizon";

/** Vector wall/ladder scope from DTE horizon toggle. */
export function vectorGexScopeLabel(horizon: VectorDteHorizon): string {
  if (horizon === "all") return "Near-term";
  return dteHorizonLabel(horizon);
}

/** Vector strike×time heatmap — reconstructed along session spot path. */
export function vectorHeatmapScopeLabel(horizon: VectorDteHorizon): string {
  return `${vectorGexScopeLabel(horizon)} · Reconstructed`;
}

/** SPX Slayer matrix rail — 0DTE column scope. */
export function spxMatrixScopeLabel(): string {
  return "0DTE matrix";
}
