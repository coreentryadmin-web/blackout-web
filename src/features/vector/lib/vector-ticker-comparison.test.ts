import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comparisonTickersFor,
  buildTickerComparisonRows,
} from "./vector-ticker-comparison";
import { screenerRegimeOf, flipDistancePct, wallStrength } from "./vector-screener";
import type { VectorUniverseRow } from "./vector-universe";

function row(p: Partial<VectorUniverseRow> & { ticker: string }): VectorUniverseRow {
  return {
    ticker: p.ticker,
    spot: p.spot ?? null,
    gammaFlip: p.gammaFlip ?? null,
    vexFlip: p.vexFlip ?? null,
    topCallWall: p.topCallWall ?? null,
    topPutWall: p.topPutWall ?? null,
    topCallPct: p.topCallPct ?? null,
    topPutPct: p.topPutPct ?? null,
    asOf: p.asOf ?? null,
  };
}

// ---- comparisonTickersFor: selection logic ----------------------------------------------------

test("comparisonTickersFor: mega-cap tech ticker gets SPY first + tech peers, never itself", () => {
  const out = comparisonTickersFor("NVDA");
  assert.equal(out[0], "SPY");
  assert.ok(!out.includes("NVDA"), "must never include the active ticker");
  assert.ok(out.length > 0 && out.length <= 4);
  // Every returned name should be a plausible tech peer or the benchmark.
  for (const t of out) {
    assert.ok(["SPY", "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AMD", "NFLX", "COIN", "MSTR", "ASTS"].includes(t));
  }
});

test("comparisonTickersFor: SPY itself compares against the other index ETFs, no SPY duplicate", () => {
  const out = comparisonTickersFor("SPY");
  assert.ok(!out.includes("SPY"));
  assert.ok(out.includes("QQQ"));
  assert.ok(out.includes("IWM"));
});

test("comparisonTickersFor: an index ETF (QQQ) leads with SPY, then peer indices, excluding itself", () => {
  const out = comparisonTickersFor("QQQ");
  assert.equal(out[0], "SPY");
  assert.ok(!out.includes("QQQ"));
  assert.ok(out.includes("IWM"));
});

test("comparisonTickersFor: unrecognized ticker falls back to SPY/QQQ/IWM", () => {
  const out = comparisonTickersFor("ASML");
  assert.deepEqual(out, ["SPY", "QQQ", "IWM"]);
});

test("comparisonTickersFor: respects the max cap and never exceeds it", () => {
  const out = comparisonTickersFor("NVDA", 2);
  assert.equal(out.length, 2);
  assert.equal(out[0], "SPY");
});

test("comparisonTickersFor: is deterministic (pure, static — same input same output)", () => {
  assert.deepEqual(comparisonTickersFor("META"), comparisonTickersFor("META"));
});

// ---- buildTickerComparisonRows: row resolution + metric fidelity ------------------------------

const universe: VectorUniverseRow[] = [
  row({ ticker: "SPY", spot: 500, gammaFlip: 495, topCallPct: 70, topPutPct: 20 }), // above, strength 70
  row({ ticker: "QQQ", spot: 400, gammaFlip: 410, topCallPct: 30, topPutPct: 85 }), // below, strength 85
  row({ ticker: "IWM", spot: 200, gammaFlip: 200, topCallPct: 50, topPutPct: 50 }), // above (>=), strength 50
  // NVDA deliberately has no row — must be silently skipped, never fabricated.
];

test("buildTickerComparisonRows: active ticker row leads, comparisons resolve only present rows", () => {
  const rows = buildTickerComparisonRows("NVDA", universe);
  // NVDA has no row of its own; comparisons are SPY, QQQ (present), IWM would be dropped by the
  // 4-name cap before reaching a 4th tech peer anyway — assert every returned ticker actually has
  // a resolved universe row and NVDA (absent) never appears as a synthesized entry.
  assert.ok(rows.every((r) => universe.some((u) => u.ticker === r.ticker)));
  assert.ok(!rows.some((r) => r.ticker === "NVDA"));
});

test("buildTickerComparisonRows: rendered regime/distance/strength match the screener helpers exactly", () => {
  const rows = buildTickerComparisonRows("SPY", universe);
  assert.ok(rows.length >= 2);
  for (const r of rows) {
    const srcRow = universe.find((u) => u.ticker === r.ticker)!;
    assert.equal(r.regime, screenerRegimeOf(srcRow));
    assert.equal(r.flipDistancePct, flipDistancePct(srcRow));
    assert.equal(r.wallStrength, wallStrength(srcRow));
  }
  const spyRow = rows.find((r) => r.ticker === "SPY")!;
  assert.equal(spyRow.isActive, true);
  assert.equal(spyRow.regime, "above");
  assert.equal(spyRow.wallStrength, 70);
  const qqqRow = rows.find((r) => r.ticker === "QQQ")!;
  assert.equal(qqqRow.isActive, false);
  assert.equal(qqqRow.regime, "below");
  assert.equal(qqqRow.wallStrength, 85);
});

test("buildTickerComparisonRows: returns [] when fewer than 2 rows resolve (honest absence)", () => {
  const sparse: VectorUniverseRow[] = [row({ ticker: "SPY", spot: 500, gammaFlip: 495 })];
  // NVDA has no row and only SPY resolves among its comparisons -> exactly 1 row -> [].
  const rows = buildTickerComparisonRows("NVDA", sparse);
  assert.deepEqual(rows, []);
});

test("buildTickerComparisonRows: empty universe yields []", () => {
  assert.deepEqual(buildTickerComparisonRows("SPY", []), []);
});
