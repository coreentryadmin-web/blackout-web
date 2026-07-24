import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayLiveMarks, type LiveMarkRow } from "./use-live-marks.ts";
import type { TerminalPlay } from "./types.ts";

function play(over: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "192C · 0DTE",
    occ: "NVDA260724C00192000",
    score: 88,
    status: "OPEN",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    entry: 4.2,
    mark: 5.0,
    pnlPct: 19,
    greeks: null,
    ...over,
  };
}

function row(over: Partial<LiveMarkRow> = {}): LiveMarkRow {
  return {
    ticker: "NVDA",
    occ: "NVDA260724C00192000",
    mark: 6.9,
    live_pnl_pct: 64,
    stale: false,
    greeks: { delta: 0.55, gamma: 0.02, theta: -0.3, vega: 0.1, iv: 0.42 },
    ...over,
  };
}

test("overlayLiveMarks: freshest mark/P&L/greeks win, keyed by OCC", () => {
  const out = overlayLiveMarks([play()], new Map([[row().occ, row()]]));
  assert.equal(out[0]!.mark, 6.9); // board 5.0 → live 6.9
  assert.equal(out[0]!.pnlPct, 64); // board 19 → live 64
  assert.equal(out[0]!.greeks?.delta, 0.55); // board null → live greeks
});

test("overlayLiveMarks: empty lane is a no-op (returns board plays unchanged)", () => {
  const base = [play()];
  assert.equal(overlayLiveMarks(base, new Map()), base); // identity — pure enhancement
});

test("overlayLiveMarks: a play with no matching live row keeps its board values", () => {
  const other = new Map([["SPY260724C00500000", row({ occ: "SPY260724C00500000" })]]);
  const out = overlayLiveMarks([play()], other);
  assert.equal(out[0]!.mark, 5.0);
  assert.equal(out[0]!.pnlPct, 19);
  assert.equal(out[0]!.greeks, null);
});

test("overlayLiveMarks: null live fields fall back to the board value (never blank a known number)", () => {
  const out = overlayLiveMarks(
    [play()],
    new Map([[row().occ, row({ mark: null, live_pnl_pct: null, greeks: null })]]),
  );
  assert.equal(out[0]!.mark, 5.0); // fell back to board
  assert.equal(out[0]!.pnlPct, 19);
});

test("overlayLiveMarks: a play with no OCC is left untouched", () => {
  const out = overlayLiveMarks([play({ occ: null })], new Map([[row().occ, row()]]));
  assert.equal(out[0]!.mark, 5.0);
});
