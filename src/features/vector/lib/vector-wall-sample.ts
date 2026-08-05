import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import { roundFloats } from "@/lib/round-floats";
import type { WallHistorySample } from "./vector-wall-history";
import { VECTOR_ORACLE_TICKERS, normalizeVectorTicker } from "./vector-ticker";

// NOTE: this file is imported by VectorChart.tsx ("use client") — it must stay free of
// server-only imports (e.g. @/lib/ws/uw-socket). The ticker-aware server cadence function
// that needs live WS state lives in vector-wall-sample-server.ts instead; importing it here
// broke the production build (Next.js treats the whole graph reachable from a client
// boundary as client code, and uw-socket.ts transitively reaches cron routes using
// `after()`) — see docs/audit/FINDINGS.md 2026-08-05.

/** Universe + oracle cadence — 5s beads (recorder + desk stream). */
export const ORACLE_WALL_TRAIL_SAMPLE_SEC = 5;

/** Shared-universe recorder cadence — always 5s regardless of oracle membership. */
export const UNIVERSE_WALL_TRAIL_SAMPLE_SEC = 5;

/** Any ticker outside the shared universe (or live SSE on a non-oracle name) — 15s, not 5-min. */
export const NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC = 15;

/** @deprecated Use {@link NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC} — kept for env fallback min bound. */
export const DEFAULT_WALL_TRAIL_SAMPLE_SEC = NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC;

export type WallTrailSampleScope = "universe" | "live";

const EMPTY_WALLS: GexWalls = { callWalls: [], putWalls: [] };

function hasWalls(w: GexWalls | null | undefined): boolean {
  return Boolean(w && (w.callWalls.length > 0 || w.putWalls.length > 0));
}

/**
 * Build one wall-history sample (bead-rail row) from a heatmap read, or return
 * null when neither lens has walls (nothing to record). Shared by the live SSE
 * hub and the server-side universe recorder so both write byte-identical rows.
 *
 * Contract that keeps the client honest:
 *  - Round ONCE here (repo policy: round at the data layer). A float-precision
 *    delta between the persisted row and a same-bucket live row is exactly what
 *    fabricated phantom flip events on the client's first history merge.
 *  - No carry-forward: a lens with no walls this bucket records an honest gap
 *    (empty walls / null flip), never a copy of the prior reading — stale
 *    readings masquerading as fresh observations poison trails and event diffs.
 */
export function buildWallHistorySample(input: {
  time: number;
  gexWalls: GexWalls | null | undefined;
  gammaFlip: number | null | undefined;
  vexWalls: GexWalls | null | undefined;
  vexFlip: number | null | undefined;
}): WallHistorySample | null {
  const gex = hasWalls(input.gexWalls);
  const vex = hasWalls(input.vexWalls);
  if (!gex && !vex) return null;
  return roundFloats({
    time: input.time,
    walls: gex ? input.gexWalls! : EMPTY_WALLS,
    gammaFlip: gex ? input.gammaFlip ?? null : null,
    vexWalls: vex ? input.vexWalls! : null,
    vexFlip: vex ? input.vexFlip ?? null : null,
  });
}

/** Wall-trail bucket size in seconds (env-tunable, min 5s). Global fallback — prefer wallTrailSampleSecForTicker. */
export function wallTrailSampleSec(): number {
  const raw =
    process.env.NEXT_PUBLIC_VECTOR_WALL_TRAIL_SAMPLE_SEC ??
    process.env.VECTOR_WALL_TRAIL_SAMPLE_SEC ??
    String(NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 5 ? Math.floor(n) : NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC;
}

/** Client-safe trail cadence — no WS store; oracle names 5s, everything else 15s. */
export function vectorWallTrailSecClient(ticker?: string | null): number {
  if (!ticker) return NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC;
  return VECTOR_ORACLE_TICKERS.has(normalizeVectorTicker(ticker))
    ? ORACLE_WALL_TRAIL_SAMPLE_SEC
    : NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC;
}

/** Snap an epoch-second timestamp to the wall-trail bucket (15s default for live non-oracle). */
export function bucketWallSampleTime(
  epochSec: number,
  bucketSec: number = wallTrailSampleSec()
): number {
  if (!Number.isFinite(epochSec)) return epochSec;
  return Math.floor(epochSec / bucketSec) * bucketSec;
}
