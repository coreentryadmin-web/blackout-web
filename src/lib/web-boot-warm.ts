import { isWebProcess, shouldRunRthWarmLeader } from "@/lib/process-role";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { heatmapPresetTickers } from "@/lib/heatmap-allowlist";
import { primeGexOverlays } from "@/lib/gex-overlay";
import {
  loadBootstrapBundle,
  loadMergedSpxDesk,
} from "@/features/spx/lib/spx-desk-loader";

const BOOT_FLAG = "__blackoutWebBootWarmStarted" as const;

/**
 * Fire-and-forget cache priming on web-tier cold starts. Populates in-memory mirrors from
 * Redis (or triggers a single-flight matrix build) so the first member request after an ECS
 * deploy does not pay an 11–16s chain-fetch penalty.
 */
export function ensureWebBootWarm(): void {
  if (!isWebProcess()) return;
  const g = globalThis as typeof globalThis & { [BOOT_FLAG]?: boolean };
  if (g[BOOT_FLAG]) return;
  g[BOOT_FLAG] = true;

  if (shouldRunRthWarmLeader()) {
    void import("@/lib/rth-warm-leader")
      .then(({ ensureRthWarmLeader }) => ensureRthWarmLeader())
      .catch((err) => console.warn("[web-boot-warm] RTH warm leader init failed (non-fatal):", err));
  }

  void (async () => {
    const presets = heatmapPresetTickers();
    await Promise.allSettled([
      loadBootstrapBundle(),
      loadMergedSpxDesk(),
      ...presets.map(async (t) => {
        const hm = await fetchGexHeatmap(t);
        if (hm?.strikes?.length) await primeGexOverlays(t, hm.strikes);
      }),
    ]);
  })().catch((err) => {
    console.warn("[web-boot-warm] non-fatal:", err instanceof Error ? err.message : err);
  });
}
