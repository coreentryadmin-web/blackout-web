import type { SwingServingSnapshot } from "./serving-lane";
import { ageMinFromIso } from "@/lib/cron-writer-target-fresh";

/**
 * Phase-anchored swing-discovery logs many idempotent `skipped` rows to `cron_job_runs` and can
 * surface `failed` on ALB/Lambda aborts even after a successful persist — the member board reads
 * `swing:serving:latest:v1`, not the handshake row. Same discipline as zerodte-warm's scan heartbeat.
 */
export function swingServingSnapshotProvesDiscoveryHealthy(args: {
  snap: SwingServingSnapshot | null | undefined;
  sessionDay: string;
  maxAgeMin: number;
  nowMs?: number;
}): { fresh: boolean; detail: string } {
  const snap = args.snap;
  if (!snap?.asOf) {
    return { fresh: false, detail: "no swing serving snapshot" };
  }
  if (snap.sessionDay !== args.sessionDay) {
    return {
      fresh: false,
      detail: `serving snapshot session ${snap.sessionDay} (expected ${args.sessionDay})`,
    };
  }
  const ageMin = ageMinFromIso(snap.asOf, args.nowMs ?? Date.now());
  if (ageMin == null) {
    return { fresh: false, detail: "serving snapshot asOf unreadable" };
  }
  const fresh = ageMin <= args.maxAgeMin;
  return {
    fresh,
    detail: `serving snapshot asOf ${ageMin.toFixed(1)}m ago (${snap.sessionDay})`,
  };
}
