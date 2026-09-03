import type { GexHeatmapLens } from "@/lib/gex-heatmap-display";
import { SPX_DESK_FOCUS_STORAGE_KEY } from "@/features/spx/lib/spx-desk-focus";
import { SPX_MATRIX_LENS_STORAGE_KEY } from "@/features/spx/lib/spx-matrix-lens";

export const SPX_IOS_PANEL_STORAGE_KEY = "spx-ios-panel";

type HeatmapLike = {
  vex?: { cells?: Record<string, unknown> } | null;
} | null;

/** Whether VEX cells exist on the shared SPX matrix payload (mirrors SpxGexMatrixHeatmap). */
export function spxMatrixVexAvailable(heatmap: HeatmapLike): boolean {
  return Boolean(heatmap?.vex && Object.keys(heatmap.vex.cells ?? {}).length > 0);
}

/**
 * Matrix / focus UI facts for Largo — the member's active lens toggle is client-only;
 * server reads the shared heatmap cache and documents honest limits.
 */
export function spxMatrixUiStateForLargo(heatmap: HeatmapLike) {
  const vexAvailable = spxMatrixVexAvailable(heatmap);
  const available_lenses: GexHeatmapLens[] = vexAvailable ? ["gex", "vex"] : ["gex"];

  return {
    default_lens: "gex" as const,
    available_lenses,
    vex_data_present: vexAvailable,
    /**
     * False — the matrix GEX/VEX tab the member last clicked is React state in
     * SpxGexMatrixHeatmap (default `gex`). Not persisted server-side.
     */
    active_lens_readable: false,
    client_only_ui: {
      matrix_lens_toggle: `SpxGexMatrixHeatmap local state — persisted in sessionStorage (${SPX_MATRIX_LENS_STORAGE_KEY}); default GEX; auto-falls back to GEX when VEX empty`,
      focus_mode: `localStorage key ${SPX_DESK_FOCUS_STORAGE_KEY} (F key / Esc)`,
      ios_panel: `sessionStorage key ${SPX_IOS_PANEL_STORAGE_KEY}`,
    },
    largo_guidance:
      "Ask get_gex_heatmap with lens=gex or lens=vex for matrix detail. Do NOT claim to know which lens tab the member is viewing unless they say so.",
  };
}
