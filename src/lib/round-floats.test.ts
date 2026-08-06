import { test } from "node:test";
import assert from "node:assert/strict";
import { roundFloats, reconcileStrikeTotal, reconcileCellStrikeTotals } from "./round-floats";

test("rounds spurious float noise to 2dp by default", () => {
  assert.equal(roundFloats(7499.360000000001), 7499.36);
  assert.equal(roundFloats(-12701691969.618551), -12701691969.62);
});

test("leaves integers untouched (timestamps, counts, IDs)", () => {
  assert.equal(roundFloats(1751000000000), 1751000000000);
  assert.equal(roundFloats(0), 0);
  assert.equal(roundFloats(-42), -42);
});

test("leaves NaN/Infinity untouched rather than producing garbage", () => {
  assert.equal(roundFloats(NaN), NaN);
  assert.equal(roundFloats(Infinity), Infinity);
  assert.equal(roundFloats(-Infinity), -Infinity);
});

test("walks nested objects and arrays", () => {
  const input = {
    price: 7529.650000000001,
    meta: { vwap: 7514.418974358975, count: 12 },
    rows: [{ entry: 7430.900000000001, id: 9007199254740 }, { entry: null }],
  };
  assert.deepEqual(roundFloats(input), {
    price: 7529.65,
    meta: { vwap: 7514.42, count: 12 },
    rows: [{ entry: 7430.9, id: 9007199254740 }, { entry: null }],
  });
});

test("supports a custom decimal-place count", () => {
  assert.equal(roundFloats(1.23456, 4), 1.2346);
});

test("passes through non-numeric leaves unchanged", () => {
  assert.deepEqual(roundFloats({ a: "text", b: true, c: null, d: undefined }), {
    a: "text",
    b: true,
    c: null,
    d: undefined,
  });
});

// ── reconcileStrikeTotal — live-caught P0: NVDA GEX Σstrike_totals != total ────────

test("reconcileStrikeTotal: reproduces the live NVDA bug — independently-rounded total drifts from the sum of rounded strike_totals, and gets fixed", () => {
  // Same shape as production: total rounded on its own (-3032.31), strike_totals
  // rounded on their own and summing to -3032.30 — a $0.01 drift from rounding
  // composition, not a wrong number (both derive from the same raw accumulation).
  const block = { total: -3032.31, strike_totals: { "100": -1000.1, "105": -2032.2 } };
  const fixed = reconcileStrikeTotal(block)!;
  assert.equal(fixed.total, -3032.3);
  const sum = Object.values(fixed.strike_totals!).reduce((a, b) => a + b, 0);
  assert.equal(fixed.total, Math.round(sum * 100) / 100);
});

test("reconcileStrikeTotal: total exactly equals the sum whenever they already agree", () => {
  const block = { total: 100, strike_totals: { "50": 40, "55": 60 } };
  assert.equal(reconcileStrikeTotal(block)!.total, 100);
});

test("reconcileStrikeTotal: passes through blocks without strike_totals (e.g. undefined dex/charm) unchanged", () => {
  assert.equal(reconcileStrikeTotal(undefined), undefined);
  const noStrikes = { total: 5 };
  assert.equal(reconcileStrikeTotal(noStrikes), noStrikes);
});

test("reconcileStrikeTotal: an empty strike_totals map reconciles to a zero total", () => {
  const block = { total: 999, strike_totals: {} };
  assert.equal(reconcileStrikeTotal(block)!.total, 0);
});

test("reconcileStrikeTotal: ignores non-finite strike values rather than propagating NaN", () => {
  const block = { total: 5, strike_totals: { "1": 10, "2": NaN } };
  assert.equal(reconcileStrikeTotal(block)!.total, 10);
});

// ── reconcileCellStrikeTotals — Thermal matrix deep audit (2026-08-02): every ticker/
// metric showed a strike's displayed total drift 1-3 cents from what a member would
// get manually summing that strike's own displayed near-term cells ─────────────────

test("reconcileCellStrikeTotals: reproduces the live Thermal drift — a strike's rounded total disagrees with the sum of its own rounded near-term cells, and gets fixed", () => {
  // Same shape as production: strike_totals[730] rounded independently (730.02) from
  // cells (already-rounded 243.34 + 243.34 + 243.34 = 730.02 — but say upstream
  // rounding order produced 730.03 for strike_totals before this fix).
  const block = {
    cells: { "730": { "2026-08-03": 243.34, "2026-08-04": 243.34, "2026-08-05": 243.34 } },
    strike_totals: { "730": 730.03 },
  };
  const fixed = reconcileCellStrikeTotals(block, ["2026-08-03", "2026-08-04", "2026-08-05"])!;
  assert.equal(fixed.strike_totals["730"], 730.02);
  const cellSum = Object.values(block.cells["730"]).reduce((a, b) => a + b, 0);
  assert.equal(fixed.strike_totals["730"], Math.round(cellSum * 100) / 100);
});

test("reconcileCellStrikeTotals: only sums near-term expiries, leaving far-dated matrix columns out of strike_totals", () => {
  const block = {
    cells: { "100": { "2026-08-03": 50, "2027-01-15": 999 } }, // 2027-01-15 = far-dated monthly
    strike_totals: { "100": 50 },
  };
  const fixed = reconcileCellStrikeTotals(block, ["2026-08-03"])!;
  assert.equal(fixed.strike_totals["100"], 50);
});

test("reconcileCellStrikeTotals: passes through when cells/strike_totals/near_term_expiries are absent", () => {
  assert.equal(reconcileCellStrikeTotals(undefined, ["2026-08-03"]), undefined);
  const noCells = { strike_totals: { "100": 5 } };
  assert.equal(reconcileCellStrikeTotals(noCells, ["2026-08-03"]), noCells);
  const block = { cells: { "100": { "2026-08-03": 5 } }, strike_totals: { "100": 5 } };
  assert.equal(reconcileCellStrikeTotals(block, undefined), block);
  assert.equal(reconcileCellStrikeTotals(block, []), block);
});

test("reconcileCellStrikeTotals: a strike missing from cells keeps its existing strike_totals entry", () => {
  const block = {
    cells: { "100": { "2026-08-03": 5 } },
    strike_totals: { "100": 5, "105": 12 }, // 105 has no cells row (far-only strike edge case)
  };
  const fixed = reconcileCellStrikeTotals(block, ["2026-08-03"])!;
  assert.equal(fixed.strike_totals["105"], 12);
});

// RTH-scan regression (2026-07-13): Vector served the weekly gamma flip as 7622.381430556295. The
// data-layer boundary (src/lib/bie/vector-full-state.ts wraps its whole return in roundFloats) must
// serve every structure figure at 2dp. This pins the exact scanned number and a VectorFullState-
// shaped nested object so a future refactor that drops the roundFloats wrap is caught here.
test("Vector data-layer: the flagged unrounded weekly flip 7622.381430556295 serves as 7622.38", () => {
  assert.equal(roundFloats(7622.381430556295), 7622.38);
});

test("Vector data-layer: flip / walls / max pain / vexFlip / ladder round while epoch-ints are untouched", () => {
  const rounded = roundFloats({
    gammaFlip: 7622.381430556295,
    maxPain: 7554.987654321,
    vexFlip: 7600.501999,
    gexWalls: {
      callWalls: [{ strike: 7647.111111, pct: 0.4123456 }],
      putWalls: [{ strike: 7500.999999, pct: 0.31 }],
    },
    ladder: { rows: [{ strike: 7625.5, gex: 1234.56789, magnitude: 0.876543 }], maxAbs: 9999.99999 },
    // Integer-valued fields must pass through UNCHANGED (epoch millis, counts).
    asOfMs: 1720000000000,
    strikeCount: 42,
  }) as Record<string, unknown>;

  assert.equal(rounded.gammaFlip, 7622.38);
  assert.equal(rounded.maxPain, 7554.99);
  assert.equal(rounded.vexFlip, 7600.5);
  const walls = rounded.gexWalls as { callWalls: Array<{ strike: number; pct: number }>; putWalls: Array<{ strike: number }> };
  assert.equal(walls.callWalls[0]!.strike, 7647.11);
  assert.equal(walls.callWalls[0]!.pct, 0.41);
  assert.equal(walls.putWalls[0]!.strike, 7501);
  const ladder = rounded.ladder as { rows: Array<{ gex: number; magnitude: number }>; maxAbs: number };
  assert.equal(ladder.rows[0]!.gex, 1234.57);
  assert.equal(ladder.rows[0]!.magnitude, 0.88);
  assert.equal(ladder.maxAbs, 10000);
  // Untouched integers.
  assert.equal(rounded.asOfMs, 1720000000000);
  assert.equal(rounded.strikeCount, 42);
});

// ── per-KEY decimal-place overrides (keyDp) ───────────────────────────────────────
// Motivating defect: /api/market/zerodte/marks shipped provider option greeks verbatim
// (delta 0.9744760508898113, gamma 0.000800420684215033 — 16-18 fraction digits, captured
// live 2026-08-06). A flat 2dp would have DESTROYED gamma (→ 0.00), so rounding at the data
// layer needed per-field precision. See docs/audit/FINDINGS.md.

/**
 * Frozen copy of the PRE-override implementation. The whole promise of adding `keyDp` is that
 * the ~45 existing `roundFloats(x)` / `roundFloats(x, n)` call sites are byte-identical
 * afterwards. Asserting that against a literal copy of the old code is the only way to prove
 * it rather than assume it.
 */
function legacyRoundFloats<T>(value: T, dp = 2): T {
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

test("no keyDp → byte-identical to the pre-override implementation", () => {
  // Shapes drawn from what the existing call sites actually serve: scalars, deep nesting,
  // arrays of objects, arrays of bare numbers, integers, non-finites, null/undefined/strings,
  // and keys that collide with Object.prototype members (the property-injection hazard).
  const fixtures: unknown[] = [
    7499.360000000001,
    -12701691969.618551,
    0,
    NaN,
    Infinity,
    null,
    "not a number",
    [1.005, 2.005, 3, NaN],
    { price: 7529.650000000001, meta: { vwap: 7514.418974358975, count: 12 } },
    { rows: [{ entry: 7430.900000000001, id: 9007199254740 }, { entry: null }] },
    { constructor: 1.23456789, toString: 2.3456789, hasOwnProperty: 3.456789, __proto__: null },
    { cells: { "640": { "2026-08-06": 1234.5678901 } }, strike_totals: { "640": 1234.5678901 } },
    { a: { b: { c: { d: [{ e: -0.000123456789 }] } } } },
  ];
  for (const dp of [0, 2, 4, 6]) {
    for (const f of fixtures) {
      assert.deepEqual(
        roundFloats(structuredClone(f), dp),
        legacyRoundFloats(structuredClone(f), dp),
        `dp=${dp} diverged for ${JSON.stringify(f)}`
      );
    }
  }
  // And explicitly: passing an EMPTY override map is also the default path.
  assert.deepEqual(roundFloats({ x: 1.23456789 }, 2, {}), legacyRoundFloats({ x: 1.23456789 }, 2));
});

test("keyDp overrides the default dp for the named key only", () => {
  const out = roundFloats({ gamma: 0.000800420684215033, delta: 0.9744760508898113, pnl: 12.3456789 }, 2, {
    gamma: 6,
    delta: 4,
  });
  assert.equal(out.gamma, 0.0008);
  assert.equal(out.delta, 0.9745);
  assert.equal(out.pnl, 12.35); // no override → default dp
});

test("keyDp matches the IMMEDIATE key, so nested greeks resolve on their own names", () => {
  const out = roundFloats(
    { greeks: { gamma: 0.023206223912080434, vega: 0.03128651305306715, iv: 0.47277716608764614 } },
    2,
    { greeks: 0, gamma: 6, vega: 6, iv: 4 }
  );
  // `greeks: 0` must NOT leak down onto its children.
  assert.deepEqual(out.greeks, { gamma: 0.023206, vega: 0.031287, iv: 0.4728 });
});

test("array elements inherit the key of the array they live in", () => {
  const out = roundFloats({ series: [1.234567, 2.345678], other: [1.234567] }, 2, { series: 4 });
  assert.deepEqual(out.series, [1.2346, 2.3457]);
  assert.deepEqual(out.other, [1.23]);
});

test("keyDp lookup cannot resolve inherited Object.prototype members", () => {
  // `constructor`/`toString` exist on every plain object; a naive `map[key]` lookup would
  // return a function, `10 ** fn` → NaN, and silently NaN out a real number.
  const out = roundFloats({ constructor: 1.23456789, toString: 2.3456789 }, 2, { unrelated: 6 });
  assert.equal(out.constructor, 1.23);
  assert.equal(out.toString, 2.35);
});

test("keyDp ignores non-integer / negative dp entries rather than emitting NaN", () => {
  const out = roundFloats({ a: 1.23456789, b: 2.3456789, c: 3.456789 }, 2, {
    a: -1,
    b: 2.5,
    c: 4,
  } as unknown as Record<string, number>);
  assert.equal(out.a, 1.23);
  assert.equal(out.b, 2.35);
  assert.equal(out.c, 3.4568);
});

test("keyDp still leaves integers and non-finites untouched", () => {
  const out = roundFloats({ gamma: 5, delta: NaN, vega: Infinity }, 2, { gamma: 6, delta: 4, vega: 6 });
  assert.equal(out.gamma, 5);
  assert.equal(Number.isNaN(out.delta), true);
  assert.equal(out.vega, Infinity);
});

test("a 2dp default would have destroyed live 0DTE gamma — the reason keyDp exists", () => {
  // Captured live 2026-08-06 from Polygon /v3/snapshot O:SPY260807C00640000.
  const liveGamma = 0.000800420684215033;
  assert.equal(roundFloats({ gamma: liveGamma }).gamma, 0); // flat default: the number is GONE
  assert.equal(roundFloats({ gamma: liveGamma }, 2, { gamma: 6 }).gamma, 0.0008); // preserved
});
