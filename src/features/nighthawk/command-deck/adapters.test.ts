import { test } from "node:test";
import assert from "node:assert/strict";
import {
  terminalPlayFromZeroDte,
  terminalPlayFromHorizon,
  terminalPlayFromEdition,
  managementFor,
} from "./adapters.ts";

test("managementFor: RATCHET progress maps -50→0, +100→1; recommendations by P&L", () => {
  assert.equal(managementFor("RATCHET", "OPEN", -50).progress, 0);
  assert.equal(managementFor("RATCHET", "OPEN", 100).progress, 1);
  assert.ok(Math.abs(managementFor("RATCHET", "OPEN", 25).progress! - 0.5) < 1e-9);
  assert.equal(managementFor("RATCHET", "OPEN", 100).recommendation, "TRIM"); // doubled → take partial
  assert.equal(managementFor("RATCHET", "OPEN", -48).recommendation, "SELL"); // near stop
  assert.equal(managementFor("RATCHET", "TRIM", 30).recommendation, "TRIM"); // status wins
  assert.equal(managementFor("SCALE_OUT", "OPEN", 20).progress, null); // tranches, not a track
});

test("0DTE adapter: rich factors from flow-quality, RATCHET model, allocation + pnl", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "nvda",
    strike: 192,
    status: "OPEN",
    score: 88,
    live_pnl_pct: 64,
    entry_premium: 4.2,
    last_mark: 6.9,
    peak_premium: 7.4,
    trough_premium: 3.9,
    setup: {
      direction: "long",
      dte: 0,
      gamma_regime: "positive",
      flow_quality: { components: { premiumDepth: 20, aggression: 18, sweepIntensity: 16, momentum: 12 } },
      gate: { verdict: "COMMIT", blocks: [] },
      plan: { occ: "O:NVDA260724C00192000" },
      market_aligned: true,
    },
    allocation: { role: "PRIMARY", sizing: "FULL", reasons: ["rank #1 · primary semis"] },
  });
  assert.equal(play.ticker, "NVDA");
  assert.equal(play.direction, "LONG");
  assert.equal(play.contract, "192C · 0DTE");
  assert.equal(play.exitModel, "RATCHET");
  assert.equal(play.factors[0]!.label, "Premium Depth"); // biggest lever leads
  assert.equal(play.gates.find((g) => g.label === "Hard gate")!.ok, true);
  assert.equal(play.allocation!.role, "PRIMARY");
  assert.equal(play.occ, "O:NVDA260724C00192000");
  assert.equal(play.peak, 76); // (7.4/4.2 - 1) * 100
  assert.ok(Math.abs(play.progress! - (64 + 50) / 150) < 1e-9);
});

test("0DTE adapter: lost tape alignment surfaces a thesis-break warning", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "SPY", strike: 584, status: "TRIM", score: 74, live_pnl_pct: 31,
    setup: { direction: "short", dte: 0, market_aligned: false, gate: { verdict: "COMMIT" } },
  });
  assert.equal(play.direction, "SHORT");
  assert.equal(play.contract, "584P · 0DTE");
  assert.equal(play.thesisBreak!.level, "warn");
  assert.match(play.thesisBreak!.note!, /alignment lost/);
});

test("horizon adapter: SCALE_OUT model, reason as note, mid as mark", () => {
  const play = terminalPlayFromHorizon({
    ticker: "pltr", direction: "LONG", horizon: "SWING", score: 77, reason: "momentum 90%, accumulation 88%",
    contract: { strike: 52, right: "C", expiry: "2026-08-07", dte: 14, mid: 2.32 },
  });
  assert.equal(play.horizon, "SWING");
  assert.equal(play.exitModel, "SCALE_OUT");
  assert.equal(play.contract, "52C · 14DTE");
  assert.equal(play.mark, 2.32);
  assert.match(play.recNote!, /momentum 90%/);
  assert.equal(play.progress, null); // scale-out → tranches, no ratchet track
});

test("edition adapter: dossier factors, PLAN model, WATCH status", () => {
  const play = terminalPlayFromEdition({
    ticker: "AAPL", direction: "long", rank: 1, score: 82,
    factor_breakdown: { flow: 30, tech: 22, positioning: 16, smart_money: 10, news: 0 },
  });
  assert.equal(play.horizon, "LEGACY");
  assert.equal(play.exitModel, "PLAN");
  assert.equal(play.status, "WATCH");
  assert.equal(play.factors[0]!.label, "Flow");
  assert.ok(!play.factors.some((f) => f.label === "News")); // 0 dropped
  assert.equal(play.contract, "Rank 1 · next session");
});
