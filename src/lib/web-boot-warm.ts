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
import { isEtExtendedWarmHours } from "@/lib/et-market-hours";

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
      const tasks: Promise<unknown>[] = [
        loadBootstrapBundle(),
        loadMergedSpxDesk(),
        ...presets.map((t) => seedGexHeatmapFromRedis(t)),
        warmVectorStreamHub(VECTOR_DEFAULT_TICKER),
      ];
      // Gate the 0DTE board warm to the extended window (4am-8pm ET weekdays — the same
      // isEtExtendedWarmHours gate every dedicated warm cron, e.g. heatmap-warm/desk-warm,
      // already honors) rather than calling it unconditionally on every cold start.
      //
      // ROOT CAUSE (measured live 2026-10-08, CloudWatch Logs + ECS service events):
      // getZeroDteBoardPayload() serves the shared Redis board snapshot when it's fresh, but
      // 0DTE discovery crons are market-hours-only, so outside this window the snapshot is
      // ALWAYS older than BOARD_STALE_SERVE_MAX_AGE_MS (10 min) — every call therefore fell
      // through to runColdBoardBuild() -> buildAndPublishBoard() -> scanZeroDteBoard(), a
      // multi-engine FLOW/BREAKOUT/PIN discovery pass that fans the shared GEX-heatmap
      // chain fetch out across dozens of tickers, several of which escalate to a full,
      // unfiltered chain pull (shouldEscalateToFullChain in polygon-options-gex.ts).
      // Confirmed via CloudWatch Logs Insights: bursts of 20-100+
      // "[polygon-gex] full-chain escalation ADOPTED" lines
      // within 15s, repeating roughly every 15-20 minutes through the 03:30-06:30 UTC
      // overnight window (zero RTH relevance), each burst's log stream matching an ECS task
      // ID that `describe_services` showed being started/stopped within minutes (the ECS
      // service was doing a near-continuous one-task-at-a-time rolling replacement that
      // whole window, driven by a cascade of small merges each triggering its own
      // ecr-push-production.yml deploy) — i.e. EVERY fresh web task independently paid this
      // cost right as it was being registered as a live ALB target. Time-correlated 1:1 with
      // the ALB TargetResponseTime Max spikes (22-55s) and single-task CPU spikes (~90%) that
      // flagged this for investigation.
      //
      // Skipping it off-hours loses nothing real: the board it would have built is throwaway
      // (0DTE is dead data outside this window — the next real market-hours request rebuilds
      // it anyway via the same on-demand path, unaffected by this change), so the only thing
      // this removes is a pre-warm racing to warm a board nobody was going to read.
      if (isEtExtendedWarmHours()) {
        tasks.push(getZeroDteBoardPayload());
      }
      await Promise.allSettled(tasks);
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
