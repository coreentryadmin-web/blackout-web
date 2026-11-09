import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sizingWeight,
  deployedRisk,
  sessionTape,
  workingTickersOf,
  R_STOP_ABS_PCT,
} from "./cockpit.ts";
import type { TerminalPlay } from "./types.ts";

// Minimal TerminalPlay factory — only the fields the cockpit math reads.
function play(over: Partial<TerminalPlay> & { id: string; ticker: string; status: TerminalPlay["status"] }): TerminalPlay {
  return {
    direction: "LONG",
    contract: "x",
    score: 0,
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    pnlPct: null,
    ...over,
  } as TerminalPlay;
}

test("sizingWeight: FULL=1, HALF=0.5, SKIP/unknown=0 (case-insensitive)", () => {
  assert.equal(sizingWeight("FULL"), 1);
  assert.equal(sizingWeight("half"), 0.5);
  assert.equal(sizingWeight("SKIP"), 0);
  assert.equal(sizingWeight("weird"), 0);
});

test("deployedRisk: deployed counts only sanctioned names that are WORKING; limit = whole sanctioned book", () => {
  const alloc = [
    { ticker: "NVDA", sizing: "FULL" }, // working → deployed
    { ticker: "TSLA", sizing: "HALF" }, // working → deployed
    { ticker: "META", sizing: "FULL" }, // sanctioned but NOT working → limit only
    { ticker: "AMD", sizing: "SKIP" }, // not in the book at all
  ];
  const working = new Set(["NVDA", "TSLA"]);
  const r = deployedRisk(alloc, working);
  assert.deepEqual(r, { deployedR: 1.5, limitR: 2.5 });
});

test("deployedRisk: empty/absent allocation → null (strip shows '—', never 0/0)", () => {
  assert.equal(deployedRisk([], new Set(["NVDA"])), null);
  assert.equal(deployedRisk(null, new Set(["NVDA"])), null);
  assert.equal(deployedRisk(undefined, new Set()), null);
});

test("deployedRisk: case-insensitive ticker match", () => {
  const r = deployedRisk([{ ticker: "nvda", sizing: "FULL" }], new Set(["NVDA"]));
  assert.deepEqual(r, { deployedR: 1, limitR: 1 });
});

test("R_STOP_ABS_PCT is the −50% ratchet stop (1R); sessionTape converts pnl% → R by it", () => {
  assert.equal(R_STOP_ABS_PCT, 50);
});

test("sessionTape: realized (CLOSED) + open (working) in R; WATCH/pre-entry excluded", () => {
  const plays = [
    play({ id: "1", ticker: "A", status: "CLOSED", pnlPct: 100 }), // +2R realized
    play({ id: "2", ticker: "B", status: "CLOSED", pnlPct: -50 }), // −1R realized
    play({ id: "3", ticker: "C", status: "OPEN", pnlPct: 25 }), // +0.5R open
    play({ id: "4", ticker: "D", status: "HOLD", pnlPct: null }), // no mark → excluded
    play({ id: "5", ticker: "E", status: "WATCH", pnlPct: 40 }), // not entered → excluded
  ];
  const t = sessionTape(plays);
  assert.equal(t.realizedR, 1); // +2 + (−1)
  assert.equal(t.openR, 0.5);
  assert.equal(t.totalR, 1.5);
  assert.equal(t.realizedCount, 2);
  assert.equal(t.openCount, 1);
  assert.equal(t.empty, false);
  // All 0DTE → no proxy R
  assert.equal(t.hasProxyR, false);
  assert.deepEqual([...t.horizons].sort(), ["ZERO_DTE"]);
});

test("sessionTape: no entered plays → empty (never painted as a flat 0R)", () => {
  const t = sessionTape([
    play({ id: "1", ticker: "A", status: "WATCH", pnlPct: 10 }),
    play({ id: "2", ticker: "B", status: "OPEN", pnlPct: null }),
  ]);
  assert.equal(t.empty, true);
  assert.equal(t.realizedCount, 0);
  assert.equal(t.openCount, 0);
  // Pre-entry 0DTE plays → no proxy R
  assert.equal(t.hasProxyR, false);
});

test("sessionTape: SWING plays → hasProxyR=true (R-unit is 0DTE-derived, not native to swing model)", () => {
  const t = sessionTape([
    play({ id: "1", ticker: "A", status: "CLOSED", pnlPct: 50, horizon: "SWING" }), // +1R realized
    play({ id: "2", ticker: "B", status: "OPEN", pnlPct: 25, horizon: "SWING" }), // +0.5R open
  ]);
  assert.equal(t.realizedR, 1);
  assert.equal(t.openR, 0.5);
  assert.equal(t.totalR, 1.5);
  // SWING plays present → R-unit is proxy (0DTE-derived)
  assert.equal(t.hasProxyR, true);
  assert.deepEqual([...t.horizons].sort(), ["SWING"]);
});

test("sessionTape: mixed horizons (0DTE + SWING) → hasProxyR=true", () => {
  const t = sessionTape([
    play({ id: "1", ticker: "A", status: "CLOSED", pnlPct: 100, horizon: "ZERO_DTE" }), // +2R
    play({ id: "2", ticker: "B", status: "OPEN", pnlPct: 50, horizon: "SWING" }), // +1R open
  ]);
  assert.equal(t.realizedR, 2);
  assert.equal(t.openR, 1);
  // Mixed horizons → hasProxyR=true (SWING present)
  assert.equal(t.hasProxyR, true);
  assert.deepEqual([...t.horizons].sort(), ["SWING", "ZERO_DTE"]);
});

test("sessionTape: a non-contributing SWING WATCH row must NOT flip hasProxyR — the board is the FULL list (every horizon/status), so a pure-0DTE realized/open tape sitting beside a swing candidate that hasn't entered yet must not be mislabeled as mixing in swing-proxy R", () => {
  const t = sessionTape([
    play({ id: "1", ticker: "A", status: "CLOSED", pnlPct: 100, horizon: "ZERO_DTE" }), // +2R realized
    play({ id: "2", ticker: "B", status: "OPEN", pnlPct: 25, horizon: "ZERO_DTE" }), // +0.5R open
    // Never entered — pnlPct is null (per adapters.ts: WATCH/SKIP rows always carry pnlPct:null)
    // so this contributes NOTHING to realizedR/openR, yet its horizon used to still flip
    // hasProxyR because horizons.add ran before the pnlPct null-check.
    play({ id: "3", ticker: "C", status: "WATCH", pnlPct: null, horizon: "SWING" }),
  ]);
  assert.equal(t.realizedR, 2);
  assert.equal(t.openR, 0.5);
  assert.equal(t.realizedCount, 1);
  assert.equal(t.openCount, 1);
  // The P&L shown is entirely 0DTE-derived — no swing play ever fed the sum.
  assert.equal(t.hasProxyR, false);
  assert.deepEqual([...t.horizons].sort(), ["ZERO_DTE"]);
});

test("sessionTape: a SKIP SWING row (also non-contributing) must not flip hasProxyR either", () => {
  const t = sessionTape([
    play({ id: "1", ticker: "A", status: "HOLD", pnlPct: 10, horizon: "ZERO_DTE" }), // +0.2R open
    play({ id: "2", ticker: "B", status: "SKIP", pnlPct: null, horizon: "LEGACY" }),
  ]);
  assert.equal(t.hasProxyR, false);
  assert.deepEqual([...t.horizons].sort(), ["ZERO_DTE"]);
});

test("workingTickersOf: only OPEN/HOLD/TRIM, uppercased", () => {
  const s = workingTickersOf([
    play({ id: "1", ticker: "nvda", status: "OPEN" }),
    play({ id: "2", ticker: "tsla", status: "TRIM" }),
    play({ id: "3", ticker: "meta", status: "CLOSED" }),
    play({ id: "4", ticker: "amd", status: "WATCH" }),
  ]);
  assert.deepEqual([...s].sort(), ["NVDA", "TSLA"]);
});
