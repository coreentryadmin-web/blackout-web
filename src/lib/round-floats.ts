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
      // Round by MAGNITUDE, then reapply sign (fixed 2026-10-26) — plain `Math.round(v*f)/f` ties
      // toward +Infinity (`Math.round(-13.5) === -13` vs `Math.round(13.5) === 14`), so a negative
      // value sitting exactly on a display-precision tie rounds to a SMALLER magnitude than the
      // identical positive value — the same sign-biased asymmetry `fmt-money.ts`'s `fmtPct` carried
      // (its header has the full live repro). `Number.isInteger(v)` above already short-circuited
      // v===0, so only a genuine fraction reaches here. At a REAL tie the magnitude rounds UP (away
      // from zero, never to exactly 0 — Math.round(0.5) is 1, not 0), so this can never newly
      // produce a `-0` this function didn't already produce before the fix: a negative fraction
      // whose magnitude is simply < 0.5 at this precision (e.g. -0.003 at dp=2, not a tie at all)
      // rounded to `-0` under the OLD `Math.round(v*f)/f` too (JS: `Math.round` of any value in
      // (-0.5, 0) returns `-0`), and still does here (`Math.sign(v) * Math.round(small) === -1 * 0
      // === -0`, IEEE-754 sign-of-product) — unchanged, pre-existing behavior, harmless on the wire
      // (`JSON.stringify(-0) === "0"`) and intentionally left as-is rather than papered over, so
      // this fix touches ONLY the tie-breaking direction, nothing else about near-zero rounding.
      return (Math.sign(v) * Math.round(Math.abs(v) * f)) / f;
    }
    if (Array.isArray(v)) return v.map((el) => walk(el, key));
    // A `Date` has no own enumerable properties (its value lives in an internal slot, read
    // only via methods) — `Object.entries(date)` below returns `[]`, so the generic-object
    // branch would silently rebuild it as `{}`, destroying the timestamp. Pass it through
    // unchanged; `JSON.stringify` (NextResponse.json) calls `Date.prototype.toJSON()` and
    // serializes it as the correct ISO string, same as returning any other non-object leaf.
    // Live-caught 2026-10-11: `/api/market/anomalies` passes a raw pg `Date` (`detected_at`)
    // straight into `roundFloats`, so every anomaly's `detectedAt` field served to the client
    // was `{}` — which made `new Date({}).getTime()` NaN in `isFlowAnomalyRecent`, which made
    // every anomaly read as "not recent", which made `FlowAnomalyBanner` always render nothing
    // (`anomalies.length === 0` after the recency filter), regardless of how real or fresh the
    // underlying anomaly was. Any other call site passing a raw Date through this shared helper
    // (160 call sites repo-wide) had the identical latent defect.
    if (v instanceof Date) return v;
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, k);
      // sectorLeadershipFacts shape detection (Night Hawk Swings `industryGroupRsFacts()`,
      // live-caught 2026-11-09 — see reconcileSectorLeadershipDelta's doc comment below for the
      // full root cause). Unlike reconcileStrikeTotal/reconcileCellStrikeTotals/
      // reconcileTrancheFractions, which are called explicitly at each known call site, this
      // shape is detected right here so EVERY current and future consumer of roundFloats gets
      // the fix automatically, not just the one route that happened to be audited — exactly
      // because the live bug already shipped the SAME underlying object to three different
      // surface points (committed/research/scaling_out sections) in one payload, and a
      // per-route opt-in would have had to be threaded through all three (and any future one)
      // to actually close the gap.
      const name = out.nameReturnPct;
      const group = out.groupReturnPct;
      const delta = out.deltaPct;
      if (typeof name === "number" && typeof group === "number" && typeof delta === "number") {
        // Use whatever dp deltaPct's OWN key-specific rounding would apply (its keyDp override
        // if one is ever added, else the payload's default dp) — the reconciliation is a
        // replacement value for deltaPct specifically, so it should round to the same precision
        // deltaPct would otherwise have been served at.
        const deltaDp = overrides?.get("deltaPct") ?? dp;
        return reconcileSectorLeadershipDelta(
          out as Record<string, unknown> & { nameReturnPct: number; groupReturnPct: number; deltaPct: number },
          deltaDp
        );
      }
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

/**
 * Reconcile a WS-11 TRIM-SCALE `tranches[]` audit trail AFTER roundFloats: same rounding-
 * composition bug as reconcileStrikeTotal/reconcileCellStrikeTotals above, one level deeper —
 * here the drift is between SIBLING array leaves (each `fraction`), not between a leaf and a
 * separately-rounded total. `reconstructTrimScaleExecutableFromBars` (plan.ts) tracks a
 * `remaining` balance down to exactly 0 across tranches, so the UNROUNDED fractions always sum
 * to 1 (within float epsilon) regardless of how many legs fired. But roundFloats() rounds each
 * tranche's `fraction` leaf INDEPENDENTLY, and a fully-fired ⅓/⅓/⅓ trim_scale play (two trims +
 * runner, TRIM_SCALE_RULES.tranche_fraction = 1/3) rounds to 0.33/0.33/0.33 — summing to 0.99,
 * not 1.00. Not a wrong number at the SOURCE (plan.ts's `managed_pnl_pct` blends the exact,
 * unrounded fractions BEFORE this rounding pass ever touches them, so the official headline P&L
 * is unaffected) — but `tranches[]` is documented (plan.ts) as "the audit trail behind the one
 * blended official number", and a member who recomputes the blend from these DISPLAYED fractions
 * gets a result ~0.5pp below the real one. Live-caught 2026-10-25 (DELL 2026-10-14 and 11 other
 * production rows over a 90-day window): recompute-from-served-fractions gave 52.53% vs the
 * served managed_pnl_pct of 53.06%.
 *
 * Fix mirrors reconcileStrikeTotal's approach: adjust ONE value to absorb the rounding residual
 * so the displayed array is self-consistent. The LAST tranche (the runner leg — "whatever is
 * left over" by construction, per plan.ts's own comments) is the natural absorber. A split that
 * already sums to 1.00 post-rounding (e.g. the 2-leg 0.33/0.67 case) is returned UNTOUCHED — this
 * only adjusts an array whose rounded sum has actually drifted. A malformed leaf (non-finite
 * `fraction`) also returns the array untouched rather than guessing. Call this AFTER roundFloats()
 * on the SAME tranches array it rounded.
 */
export function reconcileTrancheFractions<T extends { fraction: number }>(
  tranches: T[] | null | undefined,
  dp = 2
): T[] | null | undefined {
  if (!Array.isArray(tranches) || tranches.length < 2) return tranches;
  const factor = 10 ** dp;
  let sumUnits = 0;
  for (const t of tranches) {
    if (!Number.isFinite(t.fraction)) return tranches;
    sumUnits += Math.round(t.fraction * factor);
  }
  if (sumUnits === factor) return tranches; // already self-consistent — nothing to absorb
  const residualUnits = factor - sumUnits;
  const lastIdx = tranches.length - 1;
  const last = tranches[lastIdx]!;
  const out = tranches.slice();
  out[lastIdx] = { ...last, fraction: (Math.round(last.fraction * factor) + residualUnits) / factor };
  return out;
}

/**
 * Recompute the WS-11 TRIM-SCALE blended headline FROM an already-rounded-and-RECONCILED
 * `tranches[]` array — i.e. `Σ fraction_i × exit_pnl_pct_i`, at the same display precision.
 * Call this AFTER `roundFloats()` AND `reconcileTrancheFractions()` have produced the FINAL
 * served array, and write the result back over the served `plan_pnl_pct` leaf that sits beside
 * it — never the persisted DB value.
 *
 * WHY THIS EXISTS (follow-up to `reconcileTrancheFractions` above, live-caught 2026-11-09, on
 * rows committed AFTER that 2026-10-25 fix (#6744) already shipped). #6744 closed "the rounded
 * `fraction` leaves sum to 0.99, not 1.00" — a real fix, confirmed still holding (every served
 * `fraction` array does sum to exactly 1.00). But its own doc comment (and the `FINDINGS.md`
 * entry for #6744) claimed a BROADER invariant that fix never actually delivered: "a member who
 * recomputes the blend from these DISPLAYED fractions gets a result ~0.5pp below the real one"
 * — implying recompute-from-served now agrees with the served headline. It does not, because
 * `reconcileTrancheFractions` only touches `fraction`; `exit_pnl_pct` is still rounded
 * INDEPENDENTLY by the generic `roundFloats()` walk, and the served `plan_pnl_pct` headline is
 * still the UNROUNDED, pre-reconciliation blend (`plan.ts`'s `reconstructTrimScaleExecutableFromBars`,
 * `round2(tranches.reduce((acc,t) => acc + t.fraction*t.exit_pnl_pct, 0))` over the EXACT,
 * unrounded fractions). Dumping the ENTIRE fraction-rounding residual onto the runner leg's
 * DISPLAYED weight (by construction, the leg most likely to carry an outlier `exit_pnl_pct` —
 * it rode furthest to target/stop) multiplies that distortion by the outlier P&L, which is why
 * the drift now runs 0.1–0.6pp rather than the sub-0.01pp a flat 2dp rounding alone would cause.
 * Live-confirmed on rows committed 2026-11-02…11-05 (i.e. this is still reproducing TODAY, not a
 * stale pre-#6744 symptom): META 2026-11-05 served `tranches=[{0.33,16.8},{0.33,46},{0.34,94.67}]`
 * recomputes to `52.9118` (→ 52.91) vs served `plan_pnl_pct=52.49` (+0.42pp); QQQ 2026-10-28
 * served `tranches=[{0.33,19.65},{0.33,49.56},{0.34,-50.15}]` recomputes to `5.7883` (→ 5.79) vs
 * served `6.35` (−0.56pp).
 *
 * Returns `null` on anything that cannot be blended (no array, empty array, or a non-finite
 * `fraction`/`exit_pnl_pct` leaf) rather than guessing — mirrors `reconcileTrancheFractions`'s
 * own "leave it alone rather than fabricate" posture for a malformed leaf. A single-tranche array
 * (immediate stop/time-stop, `fraction: 1`) blends to exactly its own `exit_pnl_pct`, so this is
 * provably a no-op (byte-identical to the pre-fix served value) on every row #6744's own tests
 * already cover as "untouched" — the drift this closes only exists once 2+ legs each carry their
 * OWN independently-rounded weight AND P&L.
 */
export function blendTrancheHeadlinePnlPct<T extends { fraction: number; exit_pnl_pct: number }>(
  tranches: T[] | null | undefined,
  dp = 2
): number | null {
  if (!Array.isArray(tranches) || tranches.length === 0) return null;
  let sum = 0;
  for (const t of tranches) {
    if (!Number.isFinite(t.fraction) || !Number.isFinite(t.exit_pnl_pct)) return null;
    sum += t.fraction * t.exit_pnl_pct;
  }
  // Same magnitude-then-sign rounding roundFloats()/round2() already use elsewhere in this
  // codebase (2026-10-26 tie-break fix) — reused via roundFloats() itself rather than
  // reimplemented, so this can never silently drift from the rounding the rest of the served
  // payload already uses.
  return roundFloats(sum, dp);
}

/**
 * Reconcile a `{ nameReturnPct, groupReturnPct, deltaPct }` triple — Night Hawk Swings'
 * `sectorLeadershipFacts` (`industryGroupRsFacts()`, `src/lib/swing/industry-group-rs.ts`) —
 * AFTER roundFloats rounds each of the three fields INDEPENDENTLY from its own unrounded
 * source value. `deltaPct` is computed upstream as the raw, full-precision `nameRet - groupRet`
 * and carried unmodified through swing-ingest.ts -> dossier.ts -> serving-ingest.ts ->
 * serving-lane.ts -> adapters.ts (plain passthrough at every hop — no rounding/reconcile call
 * touches any of these three keys anywhere in that chain). By the time roundFloats() rounds all
 * three fields to 2dp independently, `deltaPct` frequently does not equal
 * `round(nameReturnPct,2) - round(groupReturnPct,2)` — the subtraction a member, or a direct
 * API/Largo-tool consumer, would actually perform from the two DISPLAYED operands sitting right
 * next to it in the same object.
 *
 * Live-caught in a real `GET /api/market/nighthawk/horizons?view=swings` payload, 2026-11-09:
 * 5-7 of ~12 `sectorLeadershipFacts` occurrences mismatched by 0.01pp, e.g.
 * `nameReturnPct: -12.16, groupReturnPct: -10.95, deltaPct: -1.22` (true delta -1.21), repeated
 * across `board.lanes.SWING.committed[]`, `sections.RESEARCH[]`, `sections.SCALING_OUT[]` — the
 * same underlying dossier object served at multiple surface points in one payload.
 *
 * Same rounding-composition bug class as reconcileStrikeTotal/reconcileCellStrikeTotals/
 * reconcileTrancheFractions above — but unlike those three, which are invoked explicitly at
 * each known call site (because they either need extra caller context, e.g.
 * reconcileCellStrikeTotals needs `nearTermExpiries`, or match on key names — `total`,
 * `strike_totals` — generic enough that auto-detecting them on any object anywhere in any
 * payload would be a real false-positive risk), this triple's three key names are specific
 * enough, and the fix is self-contained enough (a pure function of the object's own three
 * fields, no extra context needed), that it is safe to detect and fix directly inside the
 * walker itself (see the call site in `roundFloats`'s object branch above) — fixing every
 * current and future consumer of `roundFloats` that ever serves this shape at once, rather than
 * requiring each one to remember to call this explicitly. That is exactly how the live bug
 * reached three separate sections of one payload despite sharing a single underlying object.
 *
 * Exported standalone (same as its three siblings) so it can be unit-tested directly and, if
 * ever needed, invoked explicitly outside a `roundFloats` pass. A non-finite or missing operand
 * on any of the three fields returns the block untouched rather than guessing.
 */
export function reconcileSectorLeadershipDelta<
  B extends { nameReturnPct?: number; groupReturnPct?: number; deltaPct?: number },
>(block: B, dp = 2): B {
  const { nameReturnPct, groupReturnPct, deltaPct } = block;
  if (
    typeof nameReturnPct !== "number" ||
    !Number.isFinite(nameReturnPct) ||
    typeof groupReturnPct !== "number" ||
    !Number.isFinite(groupReturnPct) ||
    typeof deltaPct !== "number" ||
    !Number.isFinite(deltaPct)
  ) {
    return block;
  }
  const factor = 10 ** dp;
  // Same sign-safe, round-by-magnitude formula the main walk() uses (2026-10-26 fix, see its own
  // comment above) — a plain `Math.round` here would reintroduce the identical negative-tie
  // bias that fix already removed from the rest of this file.
  const signedRound = (n: number) => (Math.sign(n) * Math.round(Math.abs(n) * factor)) / factor;
  const reconciled = signedRound(nameReturnPct - groupReturnPct);
  if (reconciled === deltaPct) return block; // already self-consistent — nothing to absorb
  return { ...block, deltaPct: reconciled };
}
