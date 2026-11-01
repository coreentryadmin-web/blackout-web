/**
 * GEX Matrix Delta Calculation
 *
 * Compares previous vs. current heatmap matrices and extracts only changed strikes.
 * Used by the hybrid cron+SSE model to broadcast incremental updates without sending
 * full 168×14 matrices on every refresh.
 */

import { roundFloats } from "@/lib/round-floats";

/**
 * Simplified matrix snapshot for delta calculation.
 * Accepts either raw array format (number[][]) or record format (Record<string, Record<string, number>>).
 */
export type GexMatrix = {
  underlying: string;
  spot: number;
  strikes: number[];
  expiries: string[];
  gex: number[][] | Record<string, Record<string, number>>;
  vex?: number[][] | Record<string, Record<string, number>>;
  asof: string;
};

export type StrikeUpdate = {
  strike: number;
  gex_call?: number;
  gex_put?: number;
  vex_call?: number;
  vex_put?: number;
};

export type MatrixDelta = {
  ticker: string;
  asof: string;
  spot: number;
  regime_text?: string;
  updated_strikes: StrikeUpdate[];
  timestamp_ms: number;
};

const CHANGE_THRESHOLD = 100; // Ignore changes < $100 notional (noise floor)

/**
 * Helper to get GEX value for a strike across all expiries.
 * Handles both array and record-based cell formats.
 *
 * BUG FIX (round 202): the array-format branch used to take the CALLER's loop index
 * (`strikeIdx`, derived from iterating `current.strikes`) and apply it directly to
 * WHICHEVER matrix's `cells` was passed in — including `previous.gex`. That is only
 * correct when `previous.strikes[i] === current.strikes[i]` for every `i`, which the
 * only structural check in `calculateMatrixDelta` (`previous.strikes.length !==
 * current.strikes.length`) never verifies. A chain whose ATM strike window shifts by
 * one strike between cron ticks (one strike rolls off the low end, a new one appears
 * at the high end) keeps the SAME strike COUNT while the strike at a given index
 * changes — so `getGexRow(previous.gex, i, ...)` would silently return a DIFFERENT
 * strike's row than the one `strike`/`strikeStr` name, comparing mismatched strikes
 * and reporting a phantom GEX delta attributed to the wrong strike (or missing a real
 * one). The record-format branch never had this bug — it already looks up by the
 * actual strike VALUE (`cells[strikeStr]`), immune to index drift — so this is a
 * drift between the two branches of one helper, not a design intent. Fixed by
 * resolving the array-format row by SEARCHING `ownStrikes` (the strikes array that
 * actually belongs to the `cells` being read) for `strike`, exactly mirroring what the
 * record branch already does by key — a strike absent from `ownStrikes` now correctly
 * returns `[]` (no data for that strike in this snapshot), the same honest-absence
 * behavior the record branch already has, instead of silently reading an unrelated row.
 */
function getGexRow(
  cells: number[][] | Record<string, Record<string, number>>,
  ownStrikes: number[],
  strike: number,
  expiries: string[]
): number[] {
  if (Array.isArray(cells)) {
    const idx = ownStrikes.indexOf(strike);
    return idx >= 0 ? cells[idx] ?? [] : [];
  }
  // Record format: cells[strikeStr][expiryStr]
  const strikeRecord = cells[String(strike)];
  if (!strikeRecord) return [];
  return expiries.map((exp) => strikeRecord[exp] ?? 0);
}

/**
 * Compare two matrices and extract strike-level deltas.
 * Returns null if matrices are structurally incompatible.
 * Handles both array and record-based cell formats.
 */
export function calculateMatrixDelta(
  previous: GexMatrix | null,
  current: GexMatrix,
  regime?: string
): MatrixDelta | null {
  if (!previous) {
    return null;
  }

  // Structural compatibility check
  if (
    previous.underlying !== current.underlying ||
    previous.strikes.length !== current.strikes.length ||
    previous.expiries.length !== current.expiries.length
  ) {
    return null;
  }

  const updated_strikes: StrikeUpdate[] = [];

  // Row-by-row comparison (each row = one strike across all expiries)
  for (let i = 0; i < current.strikes.length; i++) {
    const strike = current.strikes[i];

    const prevRow = getGexRow(previous.gex, previous.strikes, strike, previous.expiries);
    const currRow = getGexRow(current.gex, current.strikes, strike, current.expiries);

    // Aggregate GEX across expiries to detect changes
    const prevGexSum = prevRow.reduce((a, b) => a + (b ?? 0), 0);
    const currGexSum = currRow.reduce((a, b) => a + (b ?? 0), 0);
    const gexChange = Math.abs(currGexSum - prevGexSum);

    // Only include if significant change
    if (gexChange >= CHANGE_THRESHOLD) {
      updated_strikes.push({
        strike,
        gex_call: currGexSum >= 0 ? currGexSum : undefined,
        gex_put: currGexSum < 0 ? Math.abs(currGexSum) : undefined,
      });
    }
  }

  // If spot moved but strikes unchanged, still send update (for regime/regime_text changes)
  if (updated_strikes.length === 0 && Math.abs(current.spot - previous.spot) >= 1) {
    return roundFloats({
      ticker: current.underlying,
      asof: current.asof,
      spot: current.spot,
      regime_text: regime,
      updated_strikes: [],
      timestamp_ms: Date.now(),
    });
  }

  if (updated_strikes.length === 0) {
    return null;
  }

  // BUG FIX (2026-09-03): gex_call/gex_put are summed from raw, unrounded GEX cells
  // (polygon-options-gex.ts's dollar-gamma arithmetic), so they carry the same IEEE-754
  // float noise (e.g. 7499.360000000001) round-floats.ts exists to strip at the response
  // boundary — this SSE delta feed served it raw while its sibling REST route
  // (gex-heatmap/route.ts) already rounds the same underlying data.
  return roundFloats({
    ticker: current.underlying,
    asof: current.asof,
    spot: current.spot,
    regime_text: regime,
    updated_strikes,
    timestamp_ms: Date.now(),
  });
}

/**
 * For testing: force-include all strikes (ignore threshold).
 * Used during verification to ensure matrix changes are captured.
 */
export function calculateMatrixDeltaFull(
  previous: GexMatrix | null,
  current: GexMatrix,
  regime?: string
): MatrixDelta {
  if (!previous) {
    return roundFloats({
      ticker: current.underlying,
      asof: current.asof,
      spot: current.spot,
      regime_text: regime,
      updated_strikes: current.strikes.map((strike) => {
        const currRow = getGexRow(current.gex, current.strikes, strike, current.expiries);
        const currGexSum = currRow.reduce((a, b) => a + (b ?? 0), 0);
        return {
          strike,
          gex_call: currGexSum >= 0 ? currGexSum : undefined,
          gex_put: currGexSum < 0 ? Math.abs(currGexSum) : undefined,
        };
      }),
      timestamp_ms: Date.now(),
    });
  }

  const updated_strikes: StrikeUpdate[] = [];
  for (let i = 0; i < current.strikes.length; i++) {
    const strike = current.strikes[i];
    const currRow = getGexRow(current.gex, current.strikes, strike, current.expiries);
    const currGexSum = currRow.reduce((a, b) => a + (b ?? 0), 0);

    updated_strikes.push({
      strike,
      gex_call: currGexSum >= 0 ? currGexSum : undefined,
      gex_put: currGexSum < 0 ? Math.abs(currGexSum) : undefined,
    });
  }

  return roundFloats({
    ticker: current.underlying,
    asof: current.asof,
    spot: current.spot,
    regime_text: regime,
    updated_strikes,
    timestamp_ms: Date.now(),
  });
}
