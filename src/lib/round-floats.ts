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
//
// PER-KEY OVERRIDES (`keyDp`)
// ---------------------------
// A single `dp` for a whole payload is right for money-math (everything is a
// dollar amount at a similar magnitude) but WRONG the moment a payload mixes
// scales. Option greeks are the motivating case: gamma is routinely 0.0008–0.05,
// so the 2dp default would quantize it to 0.00 and DESTROY the number, while
// delta/theta/IV are perfectly readable at 4dp. `keyDp` maps an object key →
// the dp to use for numbers found under that key, so ONE call at the data layer
// can serve a mixed-scale payload instead of pushing rounding out to each
// renderer (which is how the same number ends up displayed three different ways
// on three panels).
//
// Scoping: the override matches on the IMMEDIATE key a number sits under. Array
// elements inherit their array's key (`{ pnl: [1.005, 2.005] }` → both elements
// use `keyDp.pnl`), which is what a numeric series wants. Nested objects re-key
// on their own property names, so `{ greeks: { gamma: … } }` matches `gamma`,
// not `greeks`.
//
// Callers that pass no `keyDp` are BYTE-IDENTICAL to the pre-override behavior:
// `overrides` is null and the walk takes exactly the old branch. That is not an
// assumption — round-floats.test.ts diffs this function against a frozen copy of
// the legacy implementation over the shapes the ~45 existing call sites serve.
export type RoundFloatsKeyDp = Readonly<Record<string, number>>;

export function roundFloats<T>(value: T, dp = 2, keyDp?: RoundFloatsKeyDp): T {
  const factor = 10 ** dp;
  // Build a Map rather than doing `overrides[key]` on a plain object: keys reaching this
  // lookup come from arbitrary payload property names, and a bare object lookup would also
  // resolve inherited Object.prototype members ("constructor", "toString", …) — both a real
  // wrong-precision hazard and a property-injection sink to CodeQL. A Map has no prototype
  // chain to fall through, so `undefined` unambiguously means "no override for this key".
  const entries = keyDp ? Object.entries(keyDp).filter(([, d]) => Number.isInteger(d) && d >= 0) : [];
  const overrides = entries.length ? new Map(entries) : null;
  const walk = (v: unknown, key: string | null): unknown => {
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Number.isInteger(v)) return v;
      const override = overrides && key != null ? overrides.get(key) : undefined;
      const f = override === undefined ? factor : 10 ** override;
      return Math.round(v * f) / f;
    }
    if (Array.isArray(v)) return v.map((el) => walk(el, key));
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, k);
      return out;
    }
    return v;
  };
  return walk(value, null) as T;
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

/**
 * Same rounding-composition fix as reconcileStrikeTotal, one level deeper: a
 * per-strike `strike_totals[strike]` is built from the UNROUNDED near-term cell
 * accumulation (polygon-options-gex.ts buildMetric()), then rounded independently
 * from `cells[strike][expiry]` — so Σ(round(cell)) over that strike's near-term
 * expiries can drift from round(strike_totals[strike]) by up to
 * `nearTermExpiries.length * 0.005` (each cell rounds to within half a step).
 * Live-caught via scripts/audit/thermal-matrix-validator.mjs (Thermal matrix deep
 * audit): every ticker/metric showed a 1-3 cent drift at one strike, consistent
 * with pure rounding-order noise, not a wrong dealer-gamma/-vanna/-delta/-charm
 * number (both sides derive from the same raw accumulation). Recomputing
 * `strike_totals[strike]` from the ALREADY-ROUNDED, member-visible cells makes a
 * strike's displayed total always equal what a member would get by manually
 * summing that strike's own displayed near-term cells — self-consistent by
 * construction, same principle as reconcileStrikeTotal one level up. Call this
 * AFTER roundFloats() and BEFORE reconcileStrikeTotal() (grand total should sum
 * these corrected, not the original, strike totals).
 */
export function reconcileCellStrikeTotals<
  B extends { cells?: Record<string, Record<string, number>>; strike_totals?: Record<string, number> },
>(block: B | undefined, nearTermExpiries: string[] | undefined, dp = 2): B | undefined {
  if (!block?.cells || !block.strike_totals || !nearTermExpiries?.length) return block;
  const factor = 10 ** dp;
  const nearSet = new Set(nearTermExpiries);
  // Accumulate into a Map, not a plain-object bracket assignment (`obj[strike] = ...`) —
  // strike keys are numeric strike-price strings from the Polygon chain, never
  // attacker-supplied, but CodeQL's "remote property injection" sink matches the
  // assignment SYNTAX itself regardless of taint reachability. Object.fromEntries()
  // at the end builds the plain object via a single trusted call, not a dynamic-key
  // assignment expression, so there is no such sink to flag.
  const strikeTotals = new Map<string, number>();
  for (const [strike, existing] of Object.entries(block.strike_totals)) {
    const row = block.cells[strike];
    if (!row) { strikeTotals.set(strike, existing); continue; }
    let sum = 0;
    for (const [expiry, val] of Object.entries(row)) {
      if (nearSet.has(expiry) && Number.isFinite(val)) sum += val;
    }
    strikeTotals.set(strike, Math.round(sum * factor) / factor);
  }
  return { ...block, strike_totals: Object.fromEntries(strikeTotals) } as B;
}
