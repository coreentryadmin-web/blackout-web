import { isWebProcess, shouldRunRthWarmLeader, shouldRunVectorBeadRecorder } from "@/lib/process-role";
import { seedGexHeatmapFromRedis } from "@/lib/providers/polygon-options-gex";
import { comparePresetWarmTickers } from "@/features/thermal/lib/thermal-compare-presets";
import { getZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import {
  loadBootstrapBundle,
  loadMergedSpxDesk,
} from "@/features/spx/lib/spx-desk-loader";
import { warmVectorStreamHub } from "@/features/vector/lib/vector-stream-hub";
import { VECTOR_DEFAULT_TICKER } from "@/features/vector/lib/vector-ticker";

const BOOT_FLAG = "__blackoutWebBootWarmStarted" as const;

let bootWarmInflight: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fire-and-forget cache priming on web-tier cold starts. Populates in-memory
 * mirrors from Redis (or triggers a single-flight matrix build) so the first
 * member request after an ECS deploy does not pay a chain-fetch penalty.
 *
 * Only runs on web-tier containers (PROCESS_ROLE=web) — the ingest tier has its
 * own boot via market-worker.mjs. In "all" mode (dev/staging), the staging-boot-
 * warm path in init-data-sockets handles priming instead.
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

  if (shouldRunVectorBeadRecorder()) {
    void import("@/lib/vector-bead-recorder-leader")
      .then(({ ensureVectorBeadRecorder }) => ensureVectorBeadRecorder())
      .catch((err) =>
        console.warn("[web-boot-warm] Vector bead recorder init failed (non-fatal):", err)
      );
  }

  if (!bootWarmInflight) {
    bootWarmInflight = (async () => {
      const presets = comparePresetWarmTickers();
      await Promise.allSettled([
        loadBootstrapBundle(),
        loadMergedSpxDesk(),
        ...presets.map((t) => seedGexHeatmapFromRedis(t)),
        getZeroDteBoardPayload(),
        warmVectorStreamHub(VECTOR_DEFAULT_TICKER),
      ]);
    })().catch((err) => {
      console.warn("[web-boot-warm] non-fatal:", err instanceof Error ? err.message : err);
    });
  }
}

/**
 * ECS /api/ready gate — give boot warm a short head start so the first member poll
 * after a deploy hits primed in-memory mirrors instead of a cold chain fetch.
 * Capped so deploy readiness never blocks more than a few seconds.
 */
export async function awaitWebBootWarm(maxMs = 2_500): Promise<void> {
  ensureWebBootWarm();
  if (!bootWarmInflight) return;
  await Promise.race([bootWarmInflight, sleep(maxMs)]);
}
