/**
 * Admin rail graduation snapshot — Phase 3 learning loop visibility.
 */
import {
  loadRailGraduation,
  priorsModeFromEnv,
  refreshRailGraduation,
  type RailGraduationSnapshot,
} from "@/lib/zerodte/calibration-rail-graduation";
import { loadShadowRailPriors } from "@/lib/zerodte/calibration-rail-priors";

export type ZeroDteGraduationSnapshot = RailGraduationSnapshot & {
  db_configured: boolean;
  errors: string[];
};

export async function fetchZeroDteGraduationSnapshot(opts?: {
  refresh?: boolean;
}): Promise<ZeroDteGraduationSnapshot> {
  const errors: string[] = [];
  let snapshot: RailGraduationSnapshot | null = null;

  if (opts?.refresh) {
    try {
      snapshot = await refreshRailGraduation();
    } catch (e) {
      errors.push(`refresh: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  if (!snapshot) {
    try {
      snapshot = await loadRailGraduation();
    } catch (e) {
      errors.push(`load: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  if (!snapshot) {
    return {
      generated_at: new Date().toISOString(),
      window: { since: "—", through: "—", days: 0 },
      graded_plays: 0,
      baseline_win_rate_pct: null,
      rails: [],
      origin_regime_cells: [],
      shadow_priors: null,
      shadow_week: { started_at: null, days_elapsed: null, mode: priorsModeFromEnv() },
      any_rail_ready: false,
      methodology: "No graduation snapshot yet — runs post-close via zerodte-grade cron.",
      db_configured: false,
      errors: errors.length ? errors : ["No snapshot in Redis — wait for post-close grade cron."],
    };
  }

  if (!snapshot.shadow_priors) {
    const priors = await loadShadowRailPriors().catch(() => null);
    if (priors) {
      snapshot = {
        ...snapshot,
        shadow_priors: {
          rail_weights: priors.rail_weights,
          confidence: priors.confidence,
          baseline_win_rate_pct: priors.baseline_win_rate_pct,
        },
      };
    }
  }

  return {
    ...snapshot,
    db_configured: true,
    errors,
  };
}
