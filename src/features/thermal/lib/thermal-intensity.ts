/**
 * Thermal Intensity — magnitude rail scaled to the instrument's largest |GEX| node.
 * Sign is color; width/glow encode |value| / peak (never fabricated when peak is 0).
 */

/** 0–1 intensity vs the dominant node in the active scope. */
export function thermalIntensityRatio(value: number, peak: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(peak) || peak <= 0 || value === 0) return 0;
  return Math.min(1, Math.abs(value) / peak);
}

/**
 * Rail width (% of track). Gentle curve so mid nodes read clearly; floor keeps tiny nodes visible.
 */
export function thermalIntensityWidthPct(
  ratio: number,
  opts?: { minPct?: number; maxPct?: number; curve?: number }
): number {
  const minPct = opts?.minPct ?? 2.5;
  const maxPct = opts?.maxPct ?? 100;
  const curve = opts?.curve ?? 0.78;
  if (ratio <= 0) return 0;
  const curved = Math.pow(ratio, curve);
  return Math.min(maxPct, Math.max(minPct, curved * maxPct));
}

/** Glow/opacity tier for the energy halo. */
export function thermalIntensityGlowOpacity(ratio: number): number {
  if (ratio <= 0) return 0;
  return 0.35 + ratio * 0.55;
}

/** Discrete block count (for tests / optional text fallback). */
export function thermalIntensityBlockCount(ratio: number, maxBlocks = 22): number {
  if (ratio <= 0) return 0;
  return Math.max(1, Math.round(ratio * maxBlocks));
}

export type ThermalIntensityMarker =
  | "spot"
  | "flip"
  | "callWall"
  | "putWall"
  | "anchor"
  | null;

/** Pick one row marker — spot and flip beat walls so the ladder stays legible. */
export function thermalIntensityMarkerForRow(input: {
  isSpot: boolean;
  isFlipStrike: boolean;
  isPosWall: boolean;
  isNegWall: boolean;
  isAnchor: boolean;
}): ThermalIntensityMarker {
  if (input.isSpot) return "spot";
  if (input.isFlipStrike) return "flip";
  if (input.isPosWall) return "callWall";
  if (input.isNegWall) return "putWall";
  if (input.isAnchor) return "anchor";
  return null;
}

export const THERMAL_INTENSITY_MARKER_GLYPH: Record<Exclude<ThermalIntensityMarker, null>, string> = {
  spot: "●",
  flip: "⚡",
  callWall: "🧱",
  putWall: "🛡",
  anchor: "◆",
};
