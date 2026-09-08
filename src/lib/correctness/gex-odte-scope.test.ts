import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeZeroGammaFlip,
  grossAbsFromStrikeTotals,
  grossAbsFromUwGexRows,
  isHairlineNetGammaSign,
  isNearGammaFlip,
  odteGexScopeFromHeatmap,
  odteStrikeTotalsFromCells,
  recomputeScopedGexLevels,
  resolveOdteExpiry,
  resolveZeroDteExpiry,
} from "./gex-odte-scope";

test("resolveOdteExpiry prefers today when on the axis", () => {
  assert.equal(resolveOdteExpiry(["2026-07-02", "2026-07-01", "2026-07-08"], "2026-07-01"), "2026-07-01");
  assert.equal(resolveOdteExpiry(["2026-07-02", "2026-07-08"], "2026-07-01"), "2026-07-02");
});

test("resolveOdteExpiry post-roll: today off axis → front expiry (UW oracle must match)", () => {
  // ops-auto-fix #2357: after today's 0DTE column rolls off post-close, the matrix
  // compares the front expiry column — UW must NOT still query calendar-today.
  assert.equal(resolveOdteExpiry(["2026-08-20", "2026-08-21"], "2026-08-19"), "2026-08-20");
  assert.equal(resolveZeroDteExpiry(["2026-08-20", "2026-08-21"], "2026-08-19"), null);
});

test("resolveZeroDteExpiry is strict — no front fallback", () => {
  assert.equal(resolveZeroDteExpiry(["2026-07-01", "2026-07-08"], "2026-07-01"), "2026-07-01");
  assert.equal(resolveZeroDteExpiry(["2026-07-02", "2026-07-08"], "2026-07-01"), null);
});

test("odteStrikeTotalsFromCells sums one expiry column", () => {
  const cells = {
    "7400": { "2026-07-01": -1, "2026-07-02": -9 },
    "7550": { "2026-07-01": 5, "2026-07-02": 1 },
  };
  const totals = odteStrikeTotalsFromCells(cells, [7400, 7550], "2026-07-01");
  assert.deepEqual(totals, { "7400": -1, "7550": 5 });
});

test("odteGexScopeFromHeatmap is strict 0DTE — no front-expiry fallback", () => {
  const hm = {
    spot: 7500,
    expiries: ["2026-07-02", "2026-07-08"],
    strikes: [7400, 7550],
    gex: {
      cells: {
        "7400": { "2026-07-02": -20, "2026-07-08": -99 },
        "7550": { "2026-07-02": 30, "2026-07-08": 50 },
      },
      strike_totals: { "7400": -119, "7550": 80 },
      total: -39,
      call_wall: 7550,
      put_wall: 7400,
      flip: null,
      regime: { posture: "short" as const, read: "test" },
    },
  };
  const scope = odteGexScopeFromHeatmap(hm as never, "2026-07-01");
  assert.equal(scope.expiry, null);
  assert.equal(scope.total, 0);
  assert.deepEqual(scope.strikeTotals, {});
});

test("odteGexScopeFromHeatmap builds 0DTE net from heatmap cells", () => {
  const hm = {
    spot: 7500,
    expiries: ["2026-07-01", "2026-07-02"],
    strikes: [7400, 7550],
    gex: {
      cells: {
        "7400": { "2026-07-01": -2, "2026-07-02": -20 },
        "7550": { "2026-07-01": 1, "2026-07-02": 30 },
      },
      strike_totals: { "7400": -22, "7550": 31 },
      total: 9,
      call_wall: 7550,
      put_wall: 7400,
      flip: null,
      regime: { posture: "long" as const, read: "test" },
    },
  };
  const scope = odteGexScopeFromHeatmap(hm as never, "2026-07-01");
  assert.equal(scope.expiry, "2026-07-01");
  assert.equal(scope.total, -1);
  assert.deepEqual(scope.strikeTotals, { "7400": -2, "7550": 1 });
});

test("computeZeroGammaFlip picks neg→pos crossing nearest spot (2-decimal)", () => {
  const totals = { "5990": -10, "6010": 10 };
  assert.equal(computeZeroGammaFlip(totals, 6000), 6000);
});

test("recomputeScopedGexLevels matches server wall semantics", () => {
  // Spot sits between 6000 and 6100 — the wall producer must pick from the RIGHT side of spot for
  // each bucket (2026-09-04 audit follow-up to #3495/#2417). 6000 (value 8) is the largest positive
  // strike overall, but it is BELOW spot, so it cannot be the call wall (resistance) — 6100 is the
  // only positive strike above spot. King is unconstrained (argmax |value| anywhere) and stays 6000.
  const totals = { "5900": -5, "6000": 8, "6100": 3 };
  const levels = recomputeScopedGexLevels(totals, 6050);
  assert.equal(levels.callWall, 6100);
  assert.equal(levels.putWall, 5900);
  assert.equal(levels.king, 6000);
  assert.equal(levels.netTotal, 6);
});

test("recomputeScopedGexLevels: call wall never lands below spot, put wall never above it", () => {
  // Pre-fix this returned callWall=6000 (below spot 6050) — a "wrong side of spot" bug identical
  // to the one PR #2417 fixed for wallsFromStrikeTotals/deriveWalls/computeGexRegime and #3495
  // fixed for computeGexWalls; this was the one wall producer #2417 named as still needing the
  // migration but never applied it to.
  const totals = { "5900": -5, "6000": 8, "6100": 3 };
  const levels = recomputeScopedGexLevels(totals, 6050);
  assert.ok(levels.callWall != null && levels.callWall > 6050, "call wall must sit above spot");
  assert.ok(levels.putWall != null && levels.putWall < 6050, "put wall must sit below spot");
});

test("recomputeScopedGexLevels: no qualifying strike on a side returns null rather than the wrong side", () => {
  // Every positive strike sits below spot — there is no real call wall in this book, and the
  // honest answer is null, not the largest positive value regardless of side.
  const totals = { "5900": -5, "6000": 8 };
  const levels = recomputeScopedGexLevels(totals, 6050);
  assert.equal(levels.callWall, null);
  assert.equal(levels.putWall, 5900);
});

test("recomputeScopedGexLevels: spot<=0 (unresolved spot) leaves the pick unconstrained", () => {
  // Callers pass `spot ?? 0` when spot is unknown (vector-odte-matrix-rows.ts) — that must not
  // silently null every wall; it falls back to the historical unconstrained pick.
  const totals = { "5900": -5, "6000": 8, "6100": 3 };
  const levels = recomputeScopedGexLevels(totals, 0);
  assert.equal(levels.callWall, 6000);
  assert.equal(levels.putWall, 5900);
});

test("isHairlineNetGammaSign: balanced book is hairline", () => {
  const totals = { "7400": -9_000_000_000, "7550": 8_300_000_000 };
  const net = -700_000_000;
  const gross = grossAbsFromStrikeTotals(totals);
  assert.equal(isHairlineNetGammaSign(net, gross), true);
});

test("isNearGammaFlip: spot within 0.5% of flip is near-flip", () => {
  assert.equal(isNearGammaFlip(7483.24, 7481.13), true);
  assert.equal(isNearGammaFlip(7500, 7400), false);
  assert.equal(isNearGammaFlip(0, 7481), false);
  assert.equal(isNearGammaFlip(7500, null), false);
});

test("grossAbsFromUwGexRows sums |call+put| per row", () => {
  const gross = grossAbsFromUwGexRows([
    { call_gamma_oi: 5, put_gamma_oi: -2 },
    { call_gamma_oi: -1, put_gamma_oi: -4 },
  ]);
  assert.equal(gross, 8);
});
