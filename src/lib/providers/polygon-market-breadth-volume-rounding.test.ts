// Live repro (2026-10-06, 5-engine/Ask Largo monitor): `GET /api/market/spx/desk`'s
// `market_breadth.volume_leaders` served a fractional share count (`678896466.29` for OLB) —
// Polygon's grouped-daily `v` field occasionally carries a floating-point remainder despite
// representing a whole share count. `computeMarketBreadthFromSummary` is consumed by Largo
// (`src/lib/largo/run-tool.ts`), the SPX desk, and the nighthawk/correctness/bie market-wide
// readers, so an unrounded `v` reaches every one of them.
import assert from "node:assert/strict";
import test from "node:test";
import { computeMarketBreadthFromSummary, type DailyMarketBar } from "./polygon";

function bar(T: string, overrides: Partial<DailyMarketBar> = {}): DailyMarketBar {
  return { T, o: 10, h: 11, l: 9, c: 10.5, vw: 10.2, v: 0, ...overrides };
}

test("computeMarketBreadthFromSummary: volume_leaders rounds a fractional Polygon `v` to a whole share count", () => {
  const results: DailyMarketBar[] = [
    bar("OLB", { v: 678_896_466.29 }),
    bar("FRGT", { v: 317_684_256.0 }),
  ];
  const breadth = computeMarketBreadthFromSummary(results);
  const olb = breadth.volume_leaders.find((r) => r.ticker === "OLB");
  const frgt = breadth.volume_leaders.find((r) => r.ticker === "FRGT");
  assert.ok(olb);
  assert.ok(frgt);
  assert.equal(olb!.volume, 678_896_466, "a fractional share count must round to a whole share");
  assert.equal(Number.isInteger(olb!.volume), true);
  assert.equal(frgt!.volume, 317_684_256, "an already-whole value must not be perturbed");
  assert.equal(Number.isInteger(frgt!.volume), true);
});

test("computeMarketBreadthFromSummary: volume_leaders stay sorted by volume after rounding", () => {
  const results: DailyMarketBar[] = [
    bar("A", { v: 100.6 }),
    bar("B", { v: 200.1 }),
    bar("C", { v: 50.9 }),
  ];
  const breadth = computeMarketBreadthFromSummary(results);
  assert.deepEqual(
    breadth.volume_leaders.map((r) => r.ticker),
    ["B", "A", "C"]
  );
});
