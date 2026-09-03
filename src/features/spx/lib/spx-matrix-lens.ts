import type { GexHeatmapLens } from "@/lib/gex-heatmap-display";

/** sessionStorage key for the SPX matrix GEX/VEX lens toggle (client-only UI state). */
export const SPX_MATRIX_LENS_STORAGE_KEY = "spx-matrix-lens";

const VALID: GexHeatmapLens[] = ["gex", "vex", "dex", "charm"];

export function readSpxMatrixLensFromSession(): GexHeatmapLens {
  if (typeof window === "undefined") return "gex";
  try {
    const raw = window.sessionStorage.getItem(SPX_MATRIX_LENS_STORAGE_KEY);
    if (raw && (VALID as string[]).includes(raw)) return raw as GexHeatmapLens;
  } catch {
    /* sessionStorage unavailable */
  }
  return "gex";
}

export function writeSpxMatrixLensToSession(lens: GexHeatmapLens): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SPX_MATRIX_LENS_STORAGE_KEY, lens);
  } catch {
    /* sessionStorage unavailable */
  }
}
