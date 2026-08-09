import test from "node:test";
import assert from "node:assert/strict";
import { coverage, reduceSessionToDaily, regimeAt } from "./vector-daily-regime";
import type { WallHistorySample } from "./vector-wall-history";

const sample = (over: Partial<WallHistorySample> & { time: number }): WallHistorySample => ({
  walls: { callWalls: [{ strike: 7800, notional: 1 }], putWalls: [{ strike: 7700, notional: -1 }] },
  gammaFlip: 7750,
  ...over,
}) as WallHistorySample;

test("the LAST sample of the session wins, regardless of array order", () => {
  // Dealer positioning carried into the close is what a daily candle summarises. Averaging would
  // smear an intraday flip migration into a level that never existed.
  const row = reduceSessionToDaily("2026-08-07", [
    sample({ time: 300, gammaFlip: 7710 }),
    sample({ time: 900, gammaFlip: 7760 }), // latest
    sample({ time: 600, gammaFlip: 7730 }),
  ]);
  assert.equal(row?.gammaFlip, 7760);
});

test("modeled samples are reported as not observed", () => {
  // The codebase's standing rule: modeled != observed must stay visible.
  assert.equal(reduceSessionToDaily("2026-08-07", [sample({ time: 1, modeled: true })])?.observed, false);
  assert.equal(reduceSessionToDaily("2026-08-07", [sample({ time: 1 })])?.observed, true);
  assert.equal(reduceSessionToDaily("2026-08-07", [sample({ time: 1, modeled: false })])?.observed, true);
});

test("walls are read strongest-first from each side", () => {
  const row = reduceSessionToDaily("2026-08-07", [sample({ time: 1 })]);
  assert.equal(row?.callWall, 7800);
  assert.equal(row?.putWall, 7700);
});

test("rows carrying no level at all are dropped, not emitted as gaps", () => {
  const empty = reduceSessionToDaily("2026-08-07", [
    { time: 1, walls: { callWalls: [], putWalls: [] }, gammaFlip: null } as WallHistorySample,
  ]);
  assert.equal(empty, null);
  assert.equal(reduceSessionToDaily("2026-08-07", []), null);
  assert.equal(reduceSessionToDaily("", [sample({ time: 1 })]), null);
  // Non-finite timestamps must not be selected as "latest".
  assert.equal(reduceSessionToDaily("2026-08-07", [{ time: NaN } as WallHistorySample]), null);
});

test("regime is only asserted when both inputs exist", () => {
  assert.equal(regimeAt(7760, 7750), "positive", "above the flip — dealers dampen");
  assert.equal(regimeAt(7740, 7750), "negative", "below the flip — dealers amplify");
  assert.equal(regimeAt(7750, 7750), "positive", "exactly at the flip counts as positive, not null");
  // No flip recorded => shade NOTHING rather than defaulting to a regime we cannot support.
  assert.equal(regimeAt(7760, null), null);
  assert.equal(regimeAt(null, 7750), null);
  assert.equal(regimeAt(NaN, 7750), null);
});

test("coverage states the real window so a short line cannot imply a long one", () => {
  const rows = [
    { date: "2026-08-05", gammaFlip: 1, callWall: null, putWall: null, observed: true },
    { date: "2026-07-28", gammaFlip: 1, callWall: null, putWall: null, observed: true },
    { date: "2026-08-01", gammaFlip: 1, callWall: null, putWall: null, observed: false },
  ];
  assert.deepEqual(coverage(rows), { from: "2026-07-28", to: "2026-08-05", sessions: 3 });
  assert.equal(coverage([]), null, "no rows means no claimed coverage");
});
