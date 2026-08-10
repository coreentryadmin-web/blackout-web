/**
 * GEX SHIFT EXTRACTION — recover the strike-level change table from the turn's tool results.
 *
 * THE BUG CLASS. `get_gex_matrix_changes` already returns a fully structured
 * `updated_strikes: [{ strike, gex_change, direction }]`. Largo reads it, flattens it into one
 * prose line — "GEX matrix changes (last 60s): 7800 call wall -$177.8M (weaker), 7775 -$293.6M
 * (weaker), 7725 +$310.9M (stronger)" — and the structure is gone. The renderer then had a table's
 * worth of data available as a sentence. Same shape as the Vector Pulse and Helix-derivation gaps:
 * a real capability with no path to the answering layer.
 *
 * WHY THIS IS NOT PROSE PARSING. It reads the RAW TOOL RESULT off `capturedResults`, matched by
 * STRUCTURE — an object carrying an `updated_strikes` array whose entries have a numeric `strike`
 * and `gex_change`. No regex over a sentence, no dependence on how Largo happened to phrase it. If
 * the tool was not called, there is no table; if it was, the numbers are the tool's own.
 *
 * DIRECTION IS THE TOOL'S, NOT INFERRED. `stronger`/`weaker`/`flipped` comes from the tool. The
 * renderer colours from that field rather than from the sign of the change, because "flipped" is a
 * third state that a sign test cannot express — a strike crossing zero is a different event from
 * one merely shrinking, and collapsing them would hide the more important one.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

export type GexShift = {
  strike: number;
  /** Signed change in dollar-gamma since the previous snapshot. */
  change: number;
  direction: "stronger" | "weaker" | "flipped";
};

export type GexShiftTable = {
  shifts: GexShift[];
  /** When the comparison window opened/closed, when the tool reported them. */
  asOf: string | null;
  previousAsOf: string | null;
};

const DIRECTIONS = new Set(["stronger", "weaker", "flipped"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Pull the GEX shift table out of a turn's captured tool results.
 *
 * `capturedResults` is an untyped grab-bag of every tool's output for the turn, so this walks it
 * looking for the ONE structural signature it understands and ignores everything else. Returns null
 * rather than an empty table when the tool was not called — "no shifts" and "we did not look" are
 * different, and only the first should render a table saying nothing moved.
 *
 * `limit` caps the rows: this is a scannable table, not a matrix dump, and the tool can return
 * dozens of strikes. Rows are ordered by absolute change so the cap keeps the largest moves.
 */
export function extractGexShifts(capturedResults: readonly unknown[] | null | undefined, limit = 6): GexShiftTable | null {
  for (const result of capturedResults ?? []) {
    if (!isRecord(result)) continue;
    const raw = result.updated_strikes;
    if (!Array.isArray(raw)) continue;

    const shifts: GexShift[] = [];
    for (const row of raw) {
      if (!isRecord(row)) continue;
      const strike = num(row.strike);
      const change = num(row.gex_change);
      const direction = String(row.direction ?? "");
      // Every field must be present and well-formed. A partially-parsed row would render a strike
      // with a blank change, which reads as "no movement" rather than "we could not read it".
      if (strike == null || change == null || !DIRECTIONS.has(direction)) continue;
      shifts.push({ strike, change, direction: direction as GexShift["direction"] });
    }

    if (!shifts.length) continue;
    shifts.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    return {
      shifts: shifts.slice(0, limit),
      asOf: typeof result.asof === "string" ? result.asof : null,
      previousAsOf: typeof result.previous_asof === "string" ? result.previous_asof : null,
    };
  }
  return null;
}

/** Compact signed dollar-gamma, e.g. "−$177.8M". */
export function formatGexChange(n: number): string {
  const sign = n < 0 ? "−" : "+";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
