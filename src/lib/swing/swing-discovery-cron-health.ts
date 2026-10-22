import type { CronJobHealth } from "@/lib/admin-cron-health";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import { ageMinFromIso } from "@/lib/ws/timestamp-freshness";
import type { SwingDiscoveryPhaseClaim } from "@/lib/swing/discovery-claim";
import type { SwingServingSnapshot } from "@/lib/swing/serving-lane";
import type { SwingScanPhaseWindow } from "@/lib/swing/scan-cadence";

/** EventBridge fires ~every 30m; off-phase skips should not trip cron-audit query. */
const OFF_PHASE_HANDSHAKE_MAX_MIN = 50;

/**
 * Phase-anchored swing-discovery logs many intentional skips between ET windows. Generic cron age
 * (`stale_after_min: 36h`) plus a failed persist mid-phase was failing `cron-audit-query` during RTH
 * even when the lane snapshot was current or a retry was imminent.
 */
export function applySwingDiscoveryCronHealth(
  health: CronJobHealth,
  now: Date,
  ctx: {
    sessionDay: string;
    phaseWindow: SwingScanPhaseWindow | null;
    phaseClaim: SwingDiscoveryPhaseClaim | null;
    servingSnapshot: SwingServingSnapshot | null;
  }
): CronJobHealth {
  if (health.key !== "swing-discovery") return health;
  if (!isTradingDayEt(ctx.sessionDay)) {
    if (health.status === "stale") {
      return {
        ...health,
        status: "healthy",
        status_label: "Non-trading day — discovery idle",
      };
    }
    return health;
  }

  const inPhase = ctx.phaseWindow != null;
  const claimDone = ctx.phaseClaim?.status === "done";
  const claimRunning = ctx.phaseClaim?.status === "running";

  if (claimDone && (health.status === "stale" || health.status === "failed")) {
    return {
      ...health,
      status: "healthy",
      status_label: `${ctx.phaseWindow?.phase ?? "Phase"} complete for ${ctx.sessionDay}`,
      meta: { ...(health.meta ?? {}), swing_discovery_phase_done: true },
    };
  }

  if (inPhase && claimRunning && (health.status === "stale" || health.status === "failed")) {
    return {
      ...health,
      status: "warning",
      status_label: `${ctx.phaseWindow!.phase} scan in flight`,
      meta: { ...(health.meta ?? {}), swing_discovery_phase_running: true },
    };
  }

  const claimReleasedFailure =
    health.status === "failed" &&
    (health.last_message?.includes("claim_released") ||
      health.last_message?.includes("claim released"));
  if (inPhase && claimReleasedFailure && health.age_min != null && health.age_min < OFF_PHASE_HANDSHAKE_MAX_MIN) {
    return {
      ...health,
      status: "warning",
      status_label: `${ctx.phaseWindow!.phase} scan failed — phase claim released for retry`,
      meta: { ...(health.meta ?? {}), swing_discovery_retry_pending: true },
    };
  }

  if (!inPhase && (health.status === "stale" || health.status === "failed")) {
    if (
      health.last_status === "skipped" &&
      health.age_min != null &&
      health.age_min <= OFF_PHASE_HANDSHAKE_MAX_MIN
    ) {
      return {
        ...health,
        status: "healthy",
        status_label: "Idle (between discovery phases)",
      };
    }
    const snap = ctx.servingSnapshot;
    if (snap?.sessionDay === ctx.sessionDay && snap.asOf) {
      const snapAgeMin = ageMinFromIso(snap.asOf, now.getTime());
      if (snapAgeMin != null && snapAgeMin < 24 * 60) {
        return {
          ...health,
          status: "healthy",
          status_label: `Serving snapshot current for ${ctx.sessionDay}`,
          meta: { ...(health.meta ?? {}), swing_serving_as_of: snap.asOf },
        };
      }
    }
  }

  return health;
}
