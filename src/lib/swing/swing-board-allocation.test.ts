import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateSwingBoard,
  openSwingPositionsFromLedger,
  type SwingBoardSetup,
} from "./swing-board-allocation.ts";

const setup = (ticker: string, score: number, extra: Partial<SwingBoardSetup> = {}): SwingBoardSetup => ({
  ticker,
  direction: "long",
  score,
  ...extra,
});

test("wiring maps lowercase board setups → advisory decisions with an UPPERCASE byTicker map", () => {
  const { decisions, byTicker, result } = allocateSwingBoard([
    setup("nvda", 90),
    setup("amd", 88),
    setup("smh", 86),
    setup("qqq", 84),
  ]);
  assert.equal(decisions.length, 4);
  assert.ok(byTicker.has("NVDA"));
  assert.equal(byTicker.get("NVDA")?.direction, "LONG"); // casing converted at the boundary
  // the four-name cluster still collapses to one theme through the wiring layer
  for (const d of decisions) assert.equal(d.theme, "semis");
  assert.equal(result.enforce, false);
});

test("open positions seed the aggregate through the wiring layer", () => {
  const open = [
    { ticker: "NVDA", direction: "long" as const },
    { ticker: "AMD", direction: "long" as const },
    { ticker: "SMH", direction: "long" as const },
    { ticker: "QQQ", direction: "long" as const },
  ];
  const { byTicker } = allocateSwingBoard([setup("avgo", 95)], open);
  const avgo = byTicker.get("AVGO");
  assert.equal(avgo?.themeAggregatePct, 25); // 20 seeded from open + 5
  assert.equal(avgo?.capFlags.find((f) => f.cap === "per_theme_sector")?.wouldBreach, true);
});

test("short setups convert to SHORT direction", () => {
  const { byTicker } = allocateSwingBoard([{ ticker: "XOM", direction: "short", score: 80 }]);
  assert.equal(byTicker.get("XOM")?.direction, "SHORT");
});

test("openSwingPositionsFromLedger keeps only OPEN/HOLD/TRIM and passes expiry/weight through", () => {
  const rows = [
    { ticker: "NVDA", direction: "long" as const, status: "OPEN", expiry: "2026-08-21", weightPct: 4 },
    { ticker: "AMD", direction: "long" as const, status: "CLOSED" },
    { ticker: "SMH", direction: "short" as const, status: "hold" },
    { ticker: "QQQ", direction: "long" as const, status: null },
  ];
  const open = openSwingPositionsFromLedger(rows);
  assert.deepEqual(
    open.map((o) => o.ticker),
    ["NVDA", "SMH"],
  );
  assert.equal(open[0].expiry, "2026-08-21");
  assert.equal(open[0].weightPct, 4);
});
