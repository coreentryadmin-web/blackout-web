import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { dteHorizonLabel } from "@/features/vector/lib/vector-dte-horizon";

/** Human scope for matrix-style reads (strike × expiry). */
export function matrixGexScopeLabel(scope: string, zeroDteExpiry?: string | null): string {
  if (scope === "all" || scope === "near") return "Near-term";
  if (scope === "0dte") return zeroDteExpiry ? `0DTE (${zeroDteExpiry})` : "0DTE";
  if (scope === "monthly") return "Monthly OpEx";
  return scope;
}

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
