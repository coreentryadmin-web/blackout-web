// Wave C2 — PIN wall temporal stability (design item #3, INTENTIONAL-DESIGN.md).
// DEFAULT-OFF via PIN_TEMPORAL_STABILITY until offline measurement warrants enforcement.

import { sharedCacheGet } from "@/lib/shared-cache";
import { computeGexWalls, mapFromStrikeTotalsRecord } from "@/lib/providers/gex-wall-levels";
import type { GexHistorySnapshot } from "@/lib/providers/polygon-options-gex";
import { evaluatePinRegime, type PinRegime, type PinRegimeInput } from "./pin-source";

const GEX_HISTORY_PREFIX = "gex-history";
const GEX_HEATMAP_CACHE_PREFIX = "gex-heatmap";

export const PIN_TEMPORAL_MIN_SNAPS = 2;
export const PIN_TEMPORAL_WALL_TOL = 0.005; // 0.5% of median wall level

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export function pinTemporalStabilityEnabled(): boolean {
  return envFlag("PIN_TEMPORAL_STABILITY");
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Derive pin-regime inputs from one intraday GEX history snapshot (same wall math as live pin-discovery). */
export function pinInputFromGexHistorySnapshot(snap: GexHistorySnapshot): PinRegimeInput | null {
  if (!(snap.spot > 0) || !snap.strike_totals || Object.keys(snap.strike_totals).length === 0) {
    return null;
  }
  const walls = computeGexWalls(mapFromStrikeTotalsRecord(snap.strike_totals), { spot: snap.spot });
  const callWall = walls.callWalls[0]?.strike ?? null;
  const putWall = walls.putWalls[0]?.strike ?? null;
  const callWallPct = callWall != null ? walls.callWalls.find((w) => w.strike === callWall)?.pct ?? null : null;
  const putWallPct = putWall != null ? walls.putWalls.find((w) => w.strike === putWall)?.pct ?? null : null;
  const flip = snap.flip;
  const gammaPosture =
    flip != null && Number.isFinite(flip)
      ? snap.spot >= flip
        ? ("long" as const)
        : ("short" as const)
      : null;
  return {
    spot: snap.spot,
    callWall,
    putWall,
    callWallPct,
    putWallPct,
    gammaPosture,
  };
}

export type PinTemporalCohort = "stable" | "single" | "mixed" | "insufficient";

export function classifyPinTemporalStability(args: {
  passes: Array<{ regime: PinRegime; callWall: number; putWall: number }>;
  minSnaps?: number;
  wallTol?: number;
}): { cohort: PinTemporalCohort; reason: string } {
  const minSnaps = args.minSnaps ?? PIN_TEMPORAL_MIN_SNAPS;
  const wallTol = args.wallTol ?? PIN_TEMPORAL_WALL_TOL;
  const passes = args.passes;
  if (passes.length === 0) {
    return { cohort: "insufficient", reason: "no pin-qualified snapshots in history ring" };
  }
  if (passes.length === 1) {
    return { cohort: "single", reason: "only one pin-qualified snapshot — transient bracket" };
  }
  const dir = passes[0]!.regime.fadeDirection;
  const sameDir = passes.every((p) => p.regime.fadeDirection === dir);
  const callWalls = passes.map((p) => p.callWall);
  const putWalls = passes.map((p) => p.putWall);
  const cMed = median(callWalls);
  const pMed = median(putWalls);
  const wallsStable =
    cMed != null &&
    pMed != null &&
    callWalls.every((w) => Math.abs(w - cMed) <= wallTol * cMed) &&
    putWalls.every((w) => Math.abs(w - pMed) <= wallTol * pMed);
  if (passes.length >= minSnaps && sameDir && wallsStable) {
    return {
      cohort: "stable",
      reason: `${passes.length} snapshots, same fade, walls within ${(wallTol * 100).toFixed(1)}%`,
    };
  }
  return {
    cohort: "mixed",
    reason: `multi-snap but unstable (snaps=${passes.length}, sameDir=${sameDir}, wallsStable=${wallsStable})`,
  };
}

/** Read the shared gex-history ring for a ticker (cache-reader — no upstream). */
export async function readGexHistoryRing(ticker: string): Promise<GexHistorySnapshot[]> {
  const root = ticker.toUpperCase();
  const cacheKey = `${GEX_HEATMAP_CACHE_PREFIX}:${root}`;
  const key = `${GEX_HISTORY_PREFIX}:${cacheKey}`;
  try {
    const prior = await sharedCacheGet<GexHistorySnapshot[]>(key);
    if (!Array.isArray(prior)) return [];
    return prior.filter((s) => s && typeof s.ts === "number" && s.spot > 0);
  } catch {
    return [];
  }
}

/** When PIN_TEMPORAL_STABILITY is on, require a stable multi-snapshot bracket before committing a PIN. */
export async function pinPassesTemporalStabilityGate(ticker: string): Promise<{
  ok: boolean;
  cohort: PinTemporalCohort;
  reason: string;
  qualifiedSnaps: number;
}> {
  if (!pinTemporalStabilityEnabled()) {
    return { ok: true, cohort: "stable", reason: "temporal gate disabled", qualifiedSnaps: 0 };
  }
  const ring = await readGexHistoryRing(ticker);
  const passes: Array<{ regime: PinRegime; callWall: number; putWall: number }> = [];
  for (const snap of ring) {
    const input = pinInputFromGexHistorySnapshot(snap);
    if (!input || input.callWall == null || input.putWall == null) continue;
    const regime = evaluatePinRegime(input);
    if (!regime) continue;
    passes.push({ regime, callWall: input.callWall, putWall: input.putWall });
  }
  const { cohort, reason } = classifyPinTemporalStability({ passes });
  const qualifiedSnaps = passes.length;
  if (cohort === "stable") {
    return { ok: true, cohort, reason, qualifiedSnaps };
  }
  return {
    ok: false,
    cohort,
    reason: `pin_temporal_${cohort}: ${reason}`,
    qualifiedSnaps,
  };
}
