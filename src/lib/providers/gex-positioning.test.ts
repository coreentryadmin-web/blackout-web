import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { GexHeatmap } from "./polygon-options-gex";
import { ladderFromGexStrikeExpiryCells } from "./gex-strike-expiry-ladder";
import type { UwGexStrikeExpiryRow } from "./unusual-whales";

// LARGO-126 / task #126 — the canonical GexPositioning contract never computed a "king"
// (argmax |net-gamma|) strike at all, so nighthawk/positioning.ts's warm cache-read path
// had to hardcode gex_king_strike: null even when the underlying matrix had a real one.
// This is the pure-mapper regression test proving the field is now derived correctly —
// see positioning.test.ts for the end-to-end proof that the warm path actually surfaces it.

// gex-positioning.ts (and its gex-cross-validation.ts / gex-intraday-adjust.ts imports)
// carry a real `import "server-only"` — stub the package so plain `node --test` (no
// Next.js "react-server" export condition) doesn't crash at module-load time, same
// gotcha documented across this repo's other provider test files.
mock.module("server-only", { namedExports: {} });

// ---------------------------------------------------------------------------
// Mocks for getGexPositioning's runtime dependencies. These are set at module
// load (before the dynamic import below) and read mutable knobs per test:
//   - fetchGexHeatmap returns `heatmapForFetch` (base matrix + near_term_expiries)
//   - hasLiveGexStrikeExpiry returns `wsLive`
//   - getGexStrikeExpiryLadder builds a ladder from `wsCells` using the REAL
//     production filter (ladderFromGexStrikeExpiryCells) — so the ONLY thing under
//     test is whether gex-positioning PASSES the near-term allow-list through.
//   - validateGexAgainstUW / getGexIntradayAdjusted are stubbed to null (no network).
// Mocked via relative specifiers, which tsx resolves to the SAME file URLs as the
// source's `@/...` alias imports, so the mock registry keys match. The pure-mapper
// tests below don't touch any of these, so they're unaffected.
let heatmapForFetch: GexHeatmap | null = null;
let wsLive = false;
let wsCells: Map<string, UwGexStrikeExpiryRow> = new Map();

mock.module("./polygon-options-gex", {
  namedExports: { fetchGexHeatmap: async () => heatmapForFetch },
});
mock.module("./gex-cross-validation", {
  namedExports: { validateGexAgainstUW: async () => null },
});
mock.module("./gex-intraday-adjust", {
  namedExports: { getGexIntradayAdjusted: async () => null },
});
mock.module("../ws/uw-socket", {
  namedExports: {
    hasLiveGexStrikeExpiry: () => wsLive,
    getGexStrikeExpiryLadder: (_ticker: string, allowedExpiries?: readonly string[]) => {
      const { ladder, cell_count } = ladderFromGexStrikeExpiryCells(wsCells, allowedExpiries);
      if (ladder.size === 0) return null;
      return { ladder, updatedAt: Date.now(), cell_count };
    },
  },
});

let gexPositioningFromHeatmap: typeof import("./gex-positioning").gexPositioningFromHeatmap;
let getGexPositioning: typeof import("./gex-positioning").getGexPositioning;

before(async () => {
  ({ gexPositioningFromHeatmap, getGexPositioning } = await import("./gex-positioning"));
});

/** UW per-strike WS row (only the fields the ladder builder reads). */
function wsRow(expiry: string, strike: number, net_gex: number): UwGexStrikeExpiryRow {
  return {
    ticker: "SPX",
    strike,
    expiry,
    call_gamma_oi: 0,
    put_gamma_oi: 0,
    net_gex,
    price: null,
  };
}

/** Minimal GexHeatmap with a given gex.strike_totals. Only the fields the mapper reads. */
function makeHeatmap(strikeTotals: Record<string, number>, spot = 100): GexHeatmap {
  const total = Object.values(strikeTotals).reduce((a, b) => a + b, 0);
  const strikes = Object.keys(strikeTotals).map(Number).sort((a, b) => b - a);
  return {
    underlying: "TEST",
    spot,
    change_pct: 0,
    asof: new Date().toISOString(),
    expiries: ["2026-06-26"],
    strikes,
    max_pain: null,
    gex: {
      cells: {},
      strike_totals: strikeTotals,
      call_wall: strikes[0] ?? null,
      put_wall: strikes[strikes.length - 1] ?? null,
      total,
      flip: null,
      regime: { flip: null, posture: null, read: "" },
    },
    vex: {
      cells: {},
      strike_totals: {},
      pos_wall: null,
      neg_wall: null,
      total: 0,
      flip: null,
      regime: { posture: null, read: "" },
    },
    shift: { available: false, status: "collecting" },
    source: "polygon",
    data_delay: "test",
  } as GexHeatmap;
}

test("gexPositioningFromHeatmap: gex_king_strike is the argmax |net-gamma| strike, not just the largest positive", () => {
  // 100 (call side, +40) is smaller in magnitude than 95 (put side, -70) — the king must be
  // the put strike even though it's negative, proving this isn't just "reuse call_wall".
  const p = gexPositioningFromHeatmap("TEST", makeHeatmap({ "100": 40, "95": -70, "105": 10 }));
  assert.ok(p);
  assert.equal(p!.gex_king_strike, 95);
});

test("gexPositioningFromHeatmap: gex_king_strike is null when strike_totals has no entries", () => {
  // hm.strikes must stay non-empty so gexPositioningFromHeatmap doesn't treat the whole
  // matrix as cold (that's the SEPARATE strikes.length===0 guard, tested by the cold-matrix
  // path elsewhere) — but gex.strike_totals itself is empty, so kingFromStrikeTotals's loop
  // never runs and king correctly stays null (a single present-but-zero strike would
  // trivially "win" the argmax with no competing candidate, which is not this case).
  const hm = makeHeatmap({ "100": 5 });
  hm.gex.strike_totals = {};
  const p = gexPositioningFromHeatmap("TEST", hm);
  assert.ok(p);
  assert.equal(p!.gex_king_strike, null);
});

test("gexPositioningFromHeatmap: non-finite strike keys/values are skipped", () => {
  const p = gexPositioningFromHeatmap(
    "TEST",
    makeHeatmap({ "100": 5, "not-a-strike": 999, "110": Number.NaN })
  );
  assert.ok(p);
  assert.equal(p!.gex_king_strike, 100);
});

// ---------------------------------------------------------------------------
// Regression: the live-WS wall override must be scoped to the SAME near-term expiry
// set as base.flip and the cross-val oracle. Before the fix, getGexPositioning called
// getGexStrikeExpiryLadder(root) with NO allow-list, so the WS ladder summed EVERY
// expiry and the call/put wall snapped to a far monthly/quarterly OpEx strike hundreds
// of points from the near-term flip (RTH-only; drove 500pt+ spurious cross-val
// "divergence" on SPX). This test wires a WS ladder that has BOTH near-term strikes
// near spot AND far-OpEx strikes of LARGER magnitude far from spot, and asserts the
// override picks the NEAR-TERM walls. It FAILS on the old unscoped call (far walls win)
// and PASSES once the near-term expiry set is passed through.
test("getGexPositioning: live-WS wall override is scoped to near-term expiries, not all-expiry OpEx", async () => {
  const spot = 6000;
  const NEAR = "2026-07-25";
  const FAR = "2026-09-19"; // far monthly OpEx — larger magnitude, hundreds of pts from spot

  // Base matrix carries the authoritative near-term set. Strike_totals only used by the
  // pure-mapper part (king etc.); the WS override replaces call/put wall from wsCells.
  const hm = makeHeatmap({ "6050": 1_000_000, "5950": -1_000_000 }, spot);
  hm.expiries = [NEAR, FAR];
  hm.near_term_expiries = [NEAR];
  heatmapForFetch = hm;

  // WS ladder: near-term walls at 6050/5950 (±50 from spot); far-OpEx walls at 6500/5500
  // (±500 from spot) with 50× the magnitude, so an ALL-expiry sum would pick the far pair.
  wsCells = new Map([
    [`${NEAR}|6050`, wsRow(NEAR, 6050, 1_000_000)],
    [`${NEAR}|5950`, wsRow(NEAR, 5950, -1_000_000)],
    [`${FAR}|6500`, wsRow(FAR, 6500, 50_000_000)],
    [`${FAR}|5500`, wsRow(FAR, 5500, -50_000_000)],
  ]);
  wsLive = true;

  const p = await getGexPositioning("SPX");
  assert.ok(p);
  // Near-term scope → walls hug spot. (Old unscoped bug would give 6500 / 5500.)
  assert.equal(p!.call_wall, 6050, "call_wall must come from the near-term expiry, not far OpEx");
  assert.equal(p!.put_wall, 5950, "put_wall must come from the near-term expiry, not far OpEx");
});

test("getGexPositioning: WS override off (no live channel) leaves the Polygon base walls untouched", async () => {
  const spot = 6000;
  const hm = makeHeatmap({ "6050": 1_000_000, "5950": -1_000_000 }, spot);
  hm.near_term_expiries = ["2026-07-25"];
  heatmapForFetch = hm;
  // Even if a stale ladder exists, hasLiveGexStrikeExpiry=false means the override never runs.
  wsCells = new Map([["2026-09-19|6500", wsRow("2026-09-19", 6500, 50_000_000)]]);
  wsLive = false;

  const p = await getGexPositioning("SPX");
  assert.ok(p);
  // makeHeatmap sets gex.call_wall/put_wall from sorted strikes (6050 high, 5950 low).
  assert.equal(p!.call_wall, 6050);
  assert.equal(p!.put_wall, 5950);
});
