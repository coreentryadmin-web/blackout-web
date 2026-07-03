// Shared response-shaping helper: rounds every fractional number in a
// JSON-serializable value to a fixed number of decimal places before it
// goes out over the wire.
//
// Root cause this fixes: money-math (VWAP/EMA accumulation, GEX/DEX dollar
// sums, price ratios, etc.) produces IEEE-754 floats with 6-13 spurious
// decimal digits (e.g. 7499.360000000001, -12701691969.618551) that were
// being serialized verbatim into API responses across ~16 endpoints. Each
// endpoint computes its numbers via a different code path (ma-math.ts,
// gex-positioning, spx-session, etc.) so fixing this "at the source" would
// mean touching a dozen unrelated arithmetic call sites. Rounding once at
// the response boundary — the actual data layer the client consumes — is
// the single shared fix.
//
// Integers pass through untouched (Number.isInteger short-circuits), so
// epoch-millis timestamps, counts, and IDs are never touched — only genuine
// float noise gets rounded.
export function roundFloats<T>(value: T, dp = 2): T {
  const factor = 10 ** dp;
  const walk = (v: unknown): unknown => {
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Number.isInteger(v)) return v;
      return Math.round(v * factor) / factor;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * Reconcile a `{ strike_totals, total }` block AFTER roundFloats: rounding
 * each field independently means Σ(round(strike_i)) can drift from
 * round(Σstrike_i)) by a cent or two (10 strikes × up to 0.005 each) — not a
 * wrong number (the pre-rounding totals are byte-identical, built in the
 * same accumulation loop; regime/wall math uses the unrounded values), but a
 * cosmetic inconsistency between what's displayed as the total and what the
 * displayed rows actually sum to. Recomputing `total` from the (already
 * member-visible) rounded strike_totals makes the two numbers a member could
 * manually add up always agree — self-consistent by construction. Call this
 * AFTER roundFloats() so the strike values it sums are the exact ones served.
 */
export function reconcileStrikeTotal<
  B extends { strike_totals?: Record<string, number>; total?: number },
>(block: B | undefined, dp = 2): B | undefined {
  if (!block?.strike_totals) return block;
  const factor = 10 ** dp;
  const sum = Object.values(block.strike_totals).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  // Overriding one already-optional field of a constrained generic and returning it as B is safe
  // here (we never touch any other property) — TS can't infer that through a spread, hence the cast.
  return { ...block, total: Math.round(sum * factor) / factor } as B;
}
