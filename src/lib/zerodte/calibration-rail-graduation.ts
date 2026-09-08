/**
 * Phase 3 — rail prior graduation batch (origin × regime × outcome).
 *
 * Post-close: bucket graded plays by discovery origin AND pinned reg_structure,
 * evaluate per-rail WR lift vs baseline, persist graduation verdict to Redis.
 * Enforce mode (`ZERODTE_CALIBRATION_RAIL_PRIORS=enforce`) only activates when
 * a rail clears n≥30 AND ≥5pp WR lift — shadow week runs in parallel until then.
 */
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import type { CalibrationBucket, CalibrationPlayRow } from "./calibration";
import {
  analyzeOriginBands,
  buildZeroDteCalibrationReport,
  readOriginLabel,
} from "./calibration";
import { isGradedZeroDteRow, isZeroDteWin } from "./record";
import type { DiscoveryRail } from "./market-state-engine";
import {
  loadShadowRailPriors,
  type ShadowRailPriorsSnapshot,
} from "./calibration-rail-priors";

export const RAIL_GRADUATION_KEY = "zerodte:calibration:rail-graduation:v1";
export const SHADOW_WEEK_STARTED_KEY = "zerodte:calibration:shadow-week-started:v1";
const GRADUATION_TTL_SEC = 14 * 24 * 60 * 60;

/** Phase 3 bar — higher than gate graduation (n≥10) because priors actuate merge rank. */
export const RAIL_GRADUATION_MIN_N = 30;
/** Phase 3 bar — WR lift vs baseline (percentage points). */
export const RAIL_GRADUATION_MIN_DELTA_PTS = 5;

const round1 = (v: number): number => Math.round(v * 10) / 10;

export type RailGraduationVerdict = "ready_to_enforce" | "keep_shadow" | "insufficient_data";

export type RailGraduationCell = {
  origin: string;
  reg_structure: string;
  n: number;
  wins: number;
  win_rate_pct: number | null;
  low_n: boolean;
};

export type RailGraduationRecommendation = {
  rail: DiscoveryRail;
  verdict: RailGraduationVerdict;
  n: number;
  win_rate_pct: number | null;
  baseline_win_rate_pct: number | null;
  delta_win_rate_pts: number | null;
  min_n: number;
  min_delta_pts: number;
  reason: string;
};

export type RailGraduationSnapshot = {
  generated_at: string;
  window: { since: string; through: string; days: number };
  graded_plays: number;
  baseline_win_rate_pct: number | null;
  /** Per primary rail graduation verdict. */
  rails: RailGraduationRecommendation[];
  /** Crossed origin × reg_structure cohorts (evidence). */
  origin_regime_cells: RailGraduationCell[];
  /** Shadow priors snapshot at graduation time (if available). */
  shadow_priors: Pick<
    ShadowRailPriorsSnapshot,
    "rail_weights" | "confidence" | "baseline_win_rate_pct"
  > | null;
  shadow_week: {
    started_at: string | null;
    days_elapsed: number | null;
    mode: "off" | "shadow" | "enforce";
  };
  /** True when at least one rail is ready_to_enforce. */
  any_rail_ready: boolean;
  methodology: string;
};

/** Read pinned reg_structure from feature_vector (COALESCE-pinned at commit). */
export function readRegStructureFromRow(
  row: CalibrationPlayRow & { feature_vector?: Record<string, unknown> | null }
): string {
  const vec = row.feature_vector ?? null;
  const fromVec = vec?.reg_structure;
  if (typeof fromVec === "string" && fromVec.trim()) return fromVec.trim().toUpperCase();
  return "unknown";
}

function bucketOriginRegime(
  rows: Array<CalibrationPlayRow & { feature_vector?: Record<string, unknown> | null }>
): RailGraduationCell[] {
  const byKey = new Map<string, CalibrationPlayRow[]>();
  for (const r of rows) {
    if (!isGradedZeroDteRow(r)) continue;
    const origin = readOriginLabel(r.entry_context);
    const reg = readRegStructureFromRow(r);
    const key = `${origin}|${reg}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  return Array.from(byKey.entries())
    .map(([key, group]) => {
      const [origin, reg_structure] = key.split("|");
      const wins = group.filter((r) => isZeroDteWin(r)).length;
      const n = group.length;
      return {
        origin: origin ?? "unknown",
        reg_structure: reg_structure ?? "unknown",
        n,
        wins,
        win_rate_pct: n > 0 ? round1((wins / n) * 100) : null,
        low_n: n < RAIL_GRADUATION_MIN_N,
      };
    })
    .sort((a, b) => b.n - a.n);
}

function baselineWinRate(rows: CalibrationPlayRow[]): number | null {
  const graded = rows.filter(isGradedZeroDteRow);
  if (graded.length === 0) return null;
  const wins = graded.filter(isZeroDteWin).length;
  return round1((wins / graded.length) * 100);
}

export function recommendRailGraduation(
  rail: DiscoveryRail,
  bucket: CalibrationBucket,
  baselineWr: number | null
): RailGraduationRecommendation {
  const delta =
    bucket.win_rate_pct != null && baselineWr != null ? bucket.win_rate_pct - baselineWr : null;

  let verdict: RailGraduationVerdict;
  let reason: string;

  if (bucket.n < RAIL_GRADUATION_MIN_N || bucket.win_rate_pct == null || baselineWr == null) {
    verdict = "insufficient_data";
    reason =
      bucket.n < RAIL_GRADUATION_MIN_N
        ? `${rail} has n=${bucket.n} graded plays — rail prior enforcement requires n>=${RAIL_GRADUATION_MIN_N}.`
        : `${rail} baseline unavailable — keep shadow priors only.`;
  } else if (delta != null && delta >= RAIL_GRADUATION_MIN_DELTA_PTS) {
    verdict = "ready_to_enforce";
    reason =
      `${rail} ran ${bucket.win_rate_pct}% WR (n=${bucket.n}) vs baseline ${baselineWr}% — ` +
      `+${round1(delta)} pts, clearing the ${RAIL_GRADUATION_MIN_DELTA_PTS}-pt bar. ` +
      "Rail prior may graduate from shadow to enforce when ops enables ZERODTE_CALIBRATION_RAIL_PRIORS=enforce.";
  } else if (delta != null && delta <= -RAIL_GRADUATION_MIN_DELTA_PTS) {
    verdict = "keep_shadow";
    reason =
      `${rail} underperformed baseline by ${round1(Math.abs(delta))} pts (${bucket.win_rate_pct}% vs ${baselineWr}%, n=${bucket.n}) — ` +
      "shadow down-weight only; do not enforce boost.";
  } else {
    verdict = "keep_shadow";
    reason =
      `${rail} delta ${delta != null ? round1(delta) : "—"} pts vs baseline — under the ${RAIL_GRADUATION_MIN_DELTA_PTS}-pt enforce bar. Continue shadow week.`;
  }

  return {
    rail,
    verdict,
    n: bucket.n,
    win_rate_pct: bucket.win_rate_pct,
    baseline_win_rate_pct: baselineWr,
    delta_win_rate_pts: delta != null ? round1(delta) : null,
    min_n: RAIL_GRADUATION_MIN_N,
    min_delta_pts: RAIL_GRADUATION_MIN_DELTA_PTS,
    reason,
  };
}

export function buildRailGraduationReport(input: {
  rows: Array<CalibrationPlayRow & { feature_vector?: Record<string, unknown> | null }>;
  window: { since: string; through: string; days: number };
  nowIso: string;
  shadowPriors?: ShadowRailPriorsSnapshot | null;
  shadowWeekStartedAt?: string | null;
  priorsMode?: "off" | "shadow" | "enforce";
}): RailGraduationSnapshot {
  const graded = input.rows.filter(isGradedZeroDteRow);
  const originBands = analyzeOriginBands(graded);
  const baselineWr = baselineWinRate(graded);
  const primary: DiscoveryRail[] = ["FLOW", "BREAKOUT", "PIN"];

  const rails = primary.map((rail) => {
    const bucket = originBands.find((b) => b.label === rail) ?? {
      label: rail,
      n: 0,
      wins: 0,
      losses: 0,
      win_rate_pct: null,
      avg_pnl_pct: null,
      low_n: true,
      win_rate_ci_pct: null,
    };
    return recommendRailGraduation(rail, bucket, baselineWr);
  });

  const startedAt = input.shadowWeekStartedAt ?? null;
  let daysElapsed: number | null = null;
  if (startedAt) {
    const ms = Date.parse(input.nowIso) - Date.parse(startedAt);
    if (Number.isFinite(ms) && ms >= 0) daysElapsed = Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  const anyRailReady = rails.some((r) => r.verdict === "ready_to_enforce");

  return {
    generated_at: input.nowIso,
    window: input.window,
    graded_plays: graded.length,
    baseline_win_rate_pct: baselineWr,
    rails,
    origin_regime_cells: bucketOriginRegime(graded),
    shadow_priors: input.shadowPriors
      ? {
          rail_weights: input.shadowPriors.rail_weights,
          confidence: input.shadowPriors.confidence,
          baseline_win_rate_pct: input.shadowPriors.baseline_win_rate_pct,
        }
      : null,
    shadow_week: {
      started_at: startedAt,
      days_elapsed: daysElapsed,
      mode: input.priorsMode ?? priorsModeFromEnv(),
    },
    any_rail_ready: anyRailReady,
    methodology:
      "Phase 3 rail prior graduation: origin-band WR vs session baseline, n>=30, delta>=5pp to enforce. " +
      "Origin×reg_structure cells from pinned feature_vector.reg_structure. Recommend-only until ops sets enforce.",
  };
}

export function priorsModeFromEnv(): "off" | "shadow" | "enforce" {
  const raw = process.env.ZERODTE_CALIBRATION_RAIL_PRIORS?.trim().toLowerCase();
  if (raw === "enforce") return "enforce";
  if (raw === "shadow" || raw === "1" || raw === "true" || raw === "on") return "shadow";
  return "off";
}

/** Enforce mode requires graduation clearance AND explicit env. */
export function railPriorsEnforceAllowed(graduation: RailGraduationSnapshot | null): boolean {
  if (priorsModeFromEnv() !== "enforce") return false;
  return graduation?.any_rail_ready === true;
}

export async function loadRailGraduation(): Promise<RailGraduationSnapshot | null> {
  try {
    const raw = await sharedCacheGet<RailGraduationSnapshot>(RAIL_GRADUATION_KEY);
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.rails)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function saveRailGraduation(snapshot: RailGraduationSnapshot): Promise<void> {
  await sharedCacheSet(RAIL_GRADUATION_KEY, snapshot, GRADUATION_TTL_SEC);
}

async function ensureShadowWeekStarted(nowIso: string): Promise<string | null> {
  if (priorsModeFromEnv() === "off") return null;
  try {
    const existing = await sharedCacheGet<string>(SHADOW_WEEK_STARTED_KEY);
    if (existing && typeof existing === "string") return existing;
    await sharedCacheSet(SHADOW_WEEK_STARTED_KEY, nowIso, GRADUATION_TTL_SEC);
    return nowIso;
  } catch {
    return null;
  }
}

/** Post-close graduation batch — best-effort, never throws. */
export async function refreshRailGraduation(opts?: {
  days?: number;
  nowMs?: number;
}): Promise<RailGraduationSnapshot | null> {
  const nowMs = opts?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  try {
    const report = await buildZeroDteCalibrationReport({ days: opts?.days ?? 30, nowMs });
    const shadowPriors = await loadShadowRailPriors().catch(() => null);
    const shadowWeekStartedAt = await ensureShadowWeekStarted(nowIso);
    const snapshot = buildRailGraduationReport({
      rows: report.available ? await fetchGraduatedRows(opts?.days ?? 30, nowMs) : [],
      window: report.window,
      nowIso,
      shadowPriors,
      shadowWeekStartedAt,
      priorsMode: priorsModeFromEnv(),
    });
    await saveRailGraduation(snapshot);
    console.info(
      `[zerodte-rail-graduation] refreshed graded=${snapshot.graded_plays} ` +
        `ready=${snapshot.rails.filter((r) => r.verdict === "ready_to_enforce").map((r) => r.rail).join(",") || "none"} ` +
        `shadow_week=${snapshot.shadow_week.days_elapsed ?? 0}d mode=${snapshot.shadow_week.mode}`
    );
    return snapshot;
  } catch (err) {
    console.warn("[zerodte-rail-graduation] refresh failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function fetchGraduatedRows(days: number, nowMs: number): Promise<CalibrationPlayRow[]> {
  const db = await import("../db");
  if (!db.dbConfigured()) return [];
  const through = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(nowMs));
  const since = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(nowMs - days * 24 * 60 * 60 * 1000)
  );
  return db.fetchZeroDteSetupLogRange(since, Math.min(2000, days * 20));
}
