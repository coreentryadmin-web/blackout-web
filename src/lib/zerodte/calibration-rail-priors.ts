/**
 * Calibration rail priors actuator (Phase 2c) — shadow mode.
 *
 * Reads origin-band win rates from the calibration report and writes per-rail weight
 * multipliers to a shared Redis key. When enabled (`ZERODTE_CALIBRATION_RAIL_PRIORS=shadow`),
 * market-state-engine blends these priors into merge ranking — no commit behavior change
 * until Phase 3 graduation (n≥30, WR lift ≥5pp).
 */
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import type { CalibrationBucket } from "./calibration";
import { buildZeroDteCalibrationReport } from "./calibration";
import type { DiscoveryRail, RailWeightMap } from "./market-state-engine";
import { BASE_RAIL_WEIGHTS, MAX_RAIL_WEIGHT_DELTA } from "./market-state-engine";
import { LOW_N_THRESHOLD } from "./record";

export const SHADOW_RAIL_PRIORS_KEY = "zerodte:calibration:rail-priors:shadow:v1";
const SHADOW_PRIORS_TTL_SEC = 7 * 24 * 60 * 60;

export type ShadowRailPriorsSnapshot = {
  generated_at: string;
  window: { since: string; through: string; days: number };
  /** Per-rail weight multipliers derived from origin-band WR vs baseline. */
  rail_weights: RailWeightMap;
  /** 0–1 — ramps with sample size across the three primary rails. */
  confidence: number;
  /** Origin-band evidence (FLOW / BREAKOUT / PIN only) for ops UI. */
  origin_evidence: Array<{
    rail: DiscoveryRail;
    label: string;
    n: number;
    win_rate_pct: number | null;
    low_n: boolean;
  }>;
  baseline_win_rate_pct: number | null;
  methodology: string;
};

const RAIL_ORIGIN_LABELS: Record<DiscoveryRail, string> = {
  FLOW: "FLOW",
  BREAKOUT: "BREAKOUT",
  PIN: "PIN",
};

function clampWeight(w: number): number {
  return Math.round(Math.max(1 - MAX_RAIL_WEIGHT_DELTA, Math.min(1 + MAX_RAIL_WEIGHT_DELTA, w)) * 1000) / 1000;
}

/** Map win-rate delta (percentage points vs baseline) to a rail weight multiplier. */
export function winRateDeltaToRailWeight(deltaPts: number, confidence: number): number {
  // +20pp → +0.20 weight (before clamp); scale by confidence so low-n priors stay near 1.0.
  const raw = 1 + (deltaPts / 100) * confidence;
  return clampWeight(raw);
}

/** Pure: derive shadow priors from origin-band buckets. */
export function computeShadowRailPriorsFromOriginBands(
  originBands: CalibrationBucket[],
  window: { since: string; through: string; days: number },
  nowIso: string
): ShadowRailPriorsSnapshot {
  const primary: DiscoveryRail[] = ["FLOW", "BREAKOUT", "PIN"];
  const evidence = primary.map((rail) => {
    const bucket = originBands.find((b) => b.label === RAIL_ORIGIN_LABELS[rail]) ?? {
      label: rail,
      n: 0,
      wins: 0,
      losses: 0,
      win_rate_pct: null,
      avg_pnl_pct: null,
      low_n: true,
      win_rate_ci_pct: null,
    };
    return {
      rail,
      label: bucket.label,
      n: bucket.n,
      win_rate_pct: bucket.win_rate_pct,
      low_n: bucket.low_n,
    };
  });

  const gradedWithWr = evidence.filter((e) => e.n > 0 && e.win_rate_pct != null);
  const totalN = evidence.reduce((s, e) => s + e.n, 0);
  const totalWins = originBands
    .filter((b) => primary.includes(b.label as DiscoveryRail))
    .reduce((s, b) => s + b.wins, 0);
  const baselineWr =
    totalN > 0 ? Math.round((totalWins / totalN) * 1000) / 10 : gradedWithWr.length > 0
      ? Math.round(
          (gradedWithWr.reduce((s, e) => s + (e.win_rate_pct ?? 0) * e.n, 0) /
            gradedWithWr.reduce((s, e) => s + e.n, 0)) *
            10
        ) / 10
      : null;

  // Confidence ramps with sample across primary rails (cap at n=30 per rail design note).
  const minRailN = Math.min(...evidence.map((e) => e.n));
  const confidence =
    minRailN >= 30 ? 1 : minRailN >= LOW_N_THRESHOLD ? 0.5 + (minRailN - LOW_N_THRESHOLD) / 50 : 0;

  const rail_weights: RailWeightMap = { ...BASE_RAIL_WEIGHTS };
  if (baselineWr != null && confidence > 0) {
    for (const e of evidence) {
      if (e.n < LOW_N_THRESHOLD || e.win_rate_pct == null) continue;
      const delta = e.win_rate_pct - baselineWr;
      rail_weights[e.rail] = winRateDeltaToRailWeight(delta, confidence);
    }
  }

  return {
    generated_at: nowIso,
    window,
    rail_weights,
    confidence,
    origin_evidence: evidence,
    baseline_win_rate_pct: baselineWr,
    methodology:
      "Shadow calibration priors from graded origin-band win rates (FLOW/BREAKOUT/PIN). " +
      "Blended into market-state merge rank when ZERODTE_CALIBRATION_RAIL_PRIORS=shadow. " +
      "Non-gating until Phase 3 graduation.",
  };
}

/** Resolve priors mode without circular import at module load. */
function priorsModeFromEnvLocal(): "off" | "shadow" | "enforce" {
  const raw = process.env.ZERODTE_CALIBRATION_RAIL_PRIORS?.trim().toLowerCase();
  if (raw === "enforce") return "enforce";
  if (raw === "shadow" || raw === "1" || raw === "true" || raw === "on") return "shadow";
  return "off";
}

/** Blend factor for shadow priors vs regime priors (0 = off, 1 = full shadow). */
export async function calibrationPriorBlendFactor(): Promise<number> {
  const mode = priorsModeFromEnvLocal();
  if (mode === "off") return 0;

  if (mode === "enforce") {
    const { loadRailGraduation, railPriorsEnforceAllowed } = await import("./calibration-rail-graduation");
    const graduation = await loadRailGraduation().catch(() => null);
    if (!railPriorsEnforceAllowed(graduation)) {
      // Fall back to shadow blend when enforce not yet earned
      return 0.35;
    }
    const raw = process.env.ZERODTE_CALIBRATION_PRIOR_BLEND?.trim();
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
    }
    return 0.65;
  }

  const raw = process.env.ZERODTE_CALIBRATION_PRIOR_BLEND?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  }
  return 0.35;
}

export async function loadShadowRailPriors(): Promise<ShadowRailPriorsSnapshot | null> {
  try {
    const raw = await sharedCacheGet<ShadowRailPriorsSnapshot>(SHADOW_RAIL_PRIORS_KEY);
    if (!raw || typeof raw !== "object" || !raw.rail_weights) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function saveShadowRailPriors(snapshot: ShadowRailPriorsSnapshot): Promise<void> {
  await sharedCacheSet(SHADOW_RAIL_PRIORS_KEY, snapshot, SHADOW_PRIORS_TTL_SEC);
}

/** Refresh shadow priors from the live calibration report. Best-effort — never throws. */
export async function refreshShadowRailPriors(opts?: { days?: number; nowMs?: number }): Promise<ShadowRailPriorsSnapshot | null> {
  const nowMs = opts?.nowMs ?? Date.now();
  try {
    const report = await buildZeroDteCalibrationReport({ days: opts?.days ?? 30, nowMs });
    const snapshot = computeShadowRailPriorsFromOriginBands(
      report.origin_bands,
      report.window,
      new Date(nowMs).toISOString()
    );
    await saveShadowRailPriors(snapshot);
    console.info(
      `[zerodte-calibration-priors] shadow refreshed conf=${snapshot.confidence} ` +
        `FLOW×${snapshot.rail_weights.FLOW} BREAKOUT×${snapshot.rail_weights.BREAKOUT} PIN×${snapshot.rail_weights.PIN} ` +
        `baseline_wr=${snapshot.baseline_win_rate_pct ?? "n/a"}`
    );
    return snapshot;
  } catch (err) {
    console.warn("[zerodte-calibration-priors] refresh failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
