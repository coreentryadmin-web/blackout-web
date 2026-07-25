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

test("horizon adapter (PR-12 de-hardcode): real factors/regime/thesisBreak flow from the serving meta", () => {
  const play = terminalPlayFromHorizon({
    ticker: "pltr", direction: "LONG", horizon: "SWING", score: 77, status: "WATCH",
    contract: { strike: 52, right: "C", expiry: "2026-08-07", dte: 14, mid: 2.32 },
    factors: [{ label: "Structure", points: 24 }, { label: "Flow", points: 15 }],
    regime: "Breakout continuation · regime 0.60",
    thesisBreak: { level: "warn", note: "thin read — 3/7 pillars grounded" },
  });
  assert.equal(play.factors[0]!.label, "Structure"); // real pillar contributions, no longer []
  assert.equal(play.regime, "Breakout continuation · regime 0.60"); // no longer null
  assert.equal(play.thesisBreak!.level, "warn"); // no longer a hardcoded 'intact'
});

test("horizon adapter (PR-12): thesisBreak DERIVES from setupState; INVALIDATED → break", () => {
  const invalid = terminalPlayFromHorizon({
    ticker: "x", direction: "LONG", horizon: "SWING", score: 61, setupState: "INVALIDATED",
    contract: { strike: 10, right: "C", expiry: "2026-08-07", dte: 14 },
  });
  assert.equal(invalid.thesisBreak!.level, "break");
  const live = terminalPlayFromHorizon({
    ticker: "y", direction: "LONG", horizon: "SWING", score: 61, setupState: "TRIGGERED",
    contract: { strike: 10, right: "C", expiry: "2026-08-07", dte: 14 },
  });
  assert.equal(live.thesisBreak!.level, "intact");
});

test("horizon adapter (PR-12): LEAPS / un-enriched caller is UNCHANGED — legacy literals preserved", () => {
  // No swing reads supplied (the live LEAPS path): factors []/regime null/thesisBreak intact — exactly as before.
  const play = terminalPlayFromHorizon({
    ticker: "aapl", direction: "LONG", horizon: "LEAPS", score: 70,
    contract: { strike: 200, right: "C", expiry: "2026-10-16", dte: 84, mid: 12.5 },
  });
  assert.deepEqual(play.factors, []);
  assert.equal(play.regime, null);
  assert.equal(play.thesisBreak!.level, "intact");
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

test("0DTE adapter: committed OPEN with aged-out gate context still passes the Hard gate (9-6b)", () => {
  // A refresh-lane committed play whose setup.gate aged to null must NOT render '✗ Hard gate'.
  const play = terminalPlayFromZeroDte({
    ticker: "nvda", strike: 190, status: "OPEN", score: 80, live_pnl_pct: 12, entry_premium: 4, last_mark: 4.5,
    setup: { direction: "long", gate: null, market_aligned: null },
  });
  const hard = play.gates.find((g) => g.label === "Hard gate")!;
  assert.equal(hard.ok, true); // working status passes even with null gate
});

test("0DTE adapter: null tape-alignment is UNKNOWN — not a green tape-align gate nor 'intact' (9-6c)", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "amd", strike: 170, status: "WATCH", score: 66,
    setup: { direction: "long", gate: { verdict: "WATCH" }, market_aligned: null },
  });
  const tape = play.gates.find((g) => g.label === "Tape align")!;
  assert.equal(tape.ok, false); // null is not a confirmed pass
  assert.equal(play.thesisBreak?.level, "unknown"); // neither intact nor degrading
});

test("0DTE adapter: market_aligned false → warn 'tape alignment lost'; true → intact + tape-align ok", () => {
  const lost = terminalPlayFromZeroDte({ ticker: "x", status: "WATCH", setup: { direction: "long", market_aligned: false } });
  assert.equal(lost.thesisBreak?.level, "warn");
  const aligned = terminalPlayFromZeroDte({ ticker: "y", status: "WATCH", setup: { direction: "long", market_aligned: true } });
  assert.equal(aligned.thesisBreak?.level, "intact");
  assert.equal(aligned.gates.find((g) => g.label === "Tape align")!.ok, true);
});

// ════════════════════════════════════════════════════════════════════════════════════
// EDGE/BOUNDARY expansion — every render-state path through terminalPlayFromZeroDte and
// the managementFor truth table. Each case asserts a real branch, not filler.
// ════════════════════════════════════════════════════════════════════════════════════

const hardGate = (p: ReturnType<typeof terminalPlayFromZeroDte>) => p.gates.find((g) => g.label === "Hard gate")!;
const tapeGate = (p: ReturnType<typeof terminalPlayFromZeroDte>) => p.gates.find((g) => g.label === "Tape align")!;

// ── Hard gate across EVERY status × gate-verdict combination (9-6b) ────────────────────
// isWorking = OPEN|HOLD|TRIM. Hard gate ok = (verdict==="COMMIT") OR isWorking. So a
// non-working row (CLOSED/WATCH/SKIP) passes the Hard gate ONLY on an explicit COMMIT.
test("0DTE adapter: Hard gate ok for EVERY working status even with a null gate (refresh-lane)", () => {
  for (const status of ["OPEN", "HOLD", "TRIM"] as const) {
    const p = terminalPlayFromZeroDte({ ticker: "nvda", status, setup: { direction: "long", gate: null } });
    assert.equal(hardGate(p).ok, true, `${status} + null gate must pass the Hard gate`);
    assert.equal(p.status, status);
  }
});

test("0DTE adapter: non-working status (CLOSED/WATCH/SKIP) fails the Hard gate unless gate verdict is COMMIT", () => {
  for (const status of ["CLOSED", "WATCH", "SKIP"] as const) {
    const blocked = terminalPlayFromZeroDte({ ticker: "amd", status, setup: { direction: "long", gate: { verdict: "WATCH" } } });
    assert.equal(hardGate(blocked).ok, false, `${status} + non-COMMIT gate must fail the Hard gate`);
    const committed = terminalPlayFromZeroDte({ ticker: "amd", status, setup: { direction: "long", gate: { verdict: "COMMIT" } } });
    assert.equal(hardGate(committed).ok, true, `${status} + COMMIT gate passes the Hard gate`);
  }
});

test("0DTE adapter: CLOSED with a null gate does NOT render a green Hard gate (data-absent ≠ pass)", () => {
  const p = terminalPlayFromZeroDte({ ticker: "meta", status: "CLOSED", setup: { direction: "long", gate: null } });
  assert.equal(hardGate(p).ok, false); // not working, no COMMIT → not a fabricated pass
});

// ── direction / contract label (long=C, short=P) + strike & dte fallbacks ──────────────
test("0DTE adapter: SHORT put uses P and the setup top_strike when src.strike is absent", () => {
  const p = terminalPlayFromZeroDte({ ticker: "spx", status: "OPEN", setup: { direction: "short", dte: 0, top_strike: 6300 } });
  assert.equal(p.direction, "SHORT");
  assert.equal(p.contract, "6300P · 0DTE"); // strike from setup.top_strike, right P
});

test("0DTE adapter: missing strike → '?', non-zero dte → 'NDTE', null dte → '?DTE'", () => {
  const noStrike = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", setup: { direction: "long", dte: 2 } });
  assert.equal(noStrike.contract, "?C · 2DTE"); // strike unknown, 2-day contract
  const nullDte = terminalPlayFromZeroDte({ ticker: "y", strike: 100, status: "OPEN", setup: { direction: "long" } });
  assert.equal(nullDte.contract, "100C · ?DTE"); // dte absent
});

test("0DTE adapter: src.strike takes precedence over setup.top_strike", () => {
  const p = terminalPlayFromZeroDte({ ticker: "z", strike: 500, status: "OPEN", setup: { direction: "long", dte: 0, top_strike: 999 } });
  assert.equal(p.contract, "500C · 0DTE");
});

// ── missing setup entirely ─────────────────────────────────────────────────────────────
test("0DTE adapter: NO setup at all — defaults to LONG, empty factors, unknown thesis, gate driven by status", () => {
  const working = terminalPlayFromZeroDte({ ticker: "nvda", status: "HOLD", live_pnl_pct: 10, entry_premium: 4, last_mark: 4.4 });
  assert.equal(working.direction, "LONG"); // asDir(undefined) → LONG
  assert.deepEqual(working.factors, []); // no flow_quality, no factor_breakdown
  assert.equal(working.regime, null); // no gamma_regime
  assert.equal(working.occ, null); // no plan.occ
  assert.equal(working.thesisBreak?.level, "unknown"); // market_aligned absent → unknown, never a fabricated intact
  assert.equal(hardGate(working).ok, true); // HOLD is working
  assert.equal(tapeGate(working).ok, false); // no true alignment read

  const idle = terminalPlayFromZeroDte({ ticker: "amd", status: "WATCH" });
  assert.equal(hardGate(idle).ok, false); // WATCH + no gate → not a pass
});

// ── factors: flow_quality wins; null flow_quality → factor_breakdown fallback ──────────
test("0DTE adapter: null flow_quality falls back to factor_breakdown (0/non-number dropped, labels mapped)", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "nvda", status: "OPEN",
    setup: {
      direction: "long",
      flow_quality: null, // no components → fall back
      factor_breakdown: { flow: 30, tech: 22, positioning: 0, news: 8, smart_money: 5 },
    },
  });
  const labels = p.factors.map((f) => f.label);
  assert.ok(labels.includes("Flow") && labels.includes("Technicals") && labels.includes("Positioning") === false);
  assert.ok(!p.factors.some((f) => f.points === 0)); // 0-point positioning dropped
  assert.equal(p.factors.find((f) => f.label === "Smart Money")!.points, 5); // FB_LABELS mapping applied
});

test("0DTE adapter: empty flow_quality components object yields NO factors (still wins over factor_breakdown)", () => {
  // flow_quality.components present-but-empty is truthy → factorsFromFlowQuality([]) path, NOT the fallback.
  const p = terminalPlayFromZeroDte({
    ticker: "x", status: "OPEN",
    setup: { direction: "long", flow_quality: { components: {} }, factor_breakdown: { flow: 30 } },
  });
  assert.deepEqual(p.factors, []); // the fallback factor_breakdown is NOT consulted when components exists
});

test("0DTE adapter: unknown factor_breakdown key passes through as its own label", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", setup: { direction: "long", factor_breakdown: { unmapped_key: 9 } } });
  assert.equal(p.factors[0]!.label, "unmapped_key"); // FB_LABELS[k] ?? k
});

// ── thesis / tape-align truth table across market_aligned true/false/null ──────────────
test("0DTE adapter: market_aligned truth table → intact/warn/unknown + tape gate ok only on true", () => {
  const t = terminalPlayFromZeroDte({ ticker: "a", status: "OPEN", setup: { direction: "long", market_aligned: true } });
  assert.equal(t.thesisBreak?.level, "intact");
  assert.equal(tapeGate(t).ok, true);

  const f = terminalPlayFromZeroDte({ ticker: "b", status: "OPEN", setup: { direction: "long", market_aligned: false } });
  assert.equal(f.thesisBreak?.level, "warn");
  assert.equal(tapeGate(f).ok, false);

  const n = terminalPlayFromZeroDte({ ticker: "c", status: "OPEN", setup: { direction: "long", market_aligned: null } });
  assert.equal(n.thesisBreak?.level, "unknown");
  assert.equal(tapeGate(n).ok, false);
});

// ── peak / trough excursion math + entry-null / entry-zero guards ──────────────────────
test("0DTE adapter: peak/trough = round((premium/entry − 1) × 100); null when entry or premium missing", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "nvda", status: "TRIM", entry_premium: 4.2, last_mark: 6.9, peak_premium: 7.4, trough_premium: 3.9,
    setup: { direction: "long" },
  });
  assert.equal(p.peak, 76); // round((7.4/4.2 − 1)×100) = round(76.19)
  assert.equal(p.trough, -7); // round((3.9/4.2 − 1)×100) = round(−7.14)
  assert.equal(p.entry, 4.2);
  assert.equal(p.mark, 6.9);
});

test("0DTE adapter: entry null → entry/peak/trough all null (no divide by a missing basis)", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "WATCH", peak_premium: 5, trough_premium: 1, setup: { direction: "long" } });
  assert.equal(p.entry, null);
  assert.equal(p.peak, null);
  assert.equal(p.trough, null);
});

test("0DTE adapter: entry 0 is falsy → peak/trough null (no divide-by-zero)", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", entry_premium: 0, peak_premium: 5, trough_premium: 2, setup: { direction: "long" } });
  assert.equal(p.entry, 0); // fin(0) === 0 → surfaced as 0
  assert.equal(p.peak, null); // entry falsy guard
  assert.equal(p.trough, null);
});

test("0DTE adapter: peak present but trough missing → only trough is null", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "HOLD", entry_premium: 2, peak_premium: 3, setup: { direction: "long" } });
  assert.equal(p.peak, 50); // round((3/2 − 1)×100)
  assert.equal(p.trough, null);
});

// ── mark / pnl / score / regime / occ passthrough + non-finite guards ──────────────────
test("0DTE adapter: non-finite mark/pnl/score become null/0; NaN never leaks", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "x", status: "OPEN", score: Number.NaN, live_pnl_pct: Number.POSITIVE_INFINITY, last_mark: Number.NaN,
    setup: { direction: "long" },
  });
  assert.equal(p.score, 0); // fin(NaN) ?? 0
  assert.equal(p.pnlPct, null); // fin(Infinity) → null
  assert.equal(p.mark, null); // fin(NaN) → null
});

test("0DTE adapter: gamma_regime → 'gamma <x>' label; occ from plan; id and ticker upcased", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "nvda", status: "OPEN", score: 87.6,
    setup: { direction: "long", gamma_regime: "negative", plan: { occ: "O:NVDA260724C00190000" } },
  });
  assert.equal(p.regime, "gamma negative");
  assert.equal(p.occ, "O:NVDA260724C00190000");
  assert.equal(p.id, "0DTE:nvda"); // id keeps the raw ticker
  assert.equal(p.ticker, "NVDA"); // display upcased
  assert.equal(p.score, 88); // rounded
});

// ── allocation mapping (first reason only) + absence ───────────────────────────────────
test("0DTE adapter: allocation maps role/sizing + the FIRST reason; absent allocation → null", () => {
  const withAlloc = terminalPlayFromZeroDte({
    ticker: "x", status: "OPEN", setup: { direction: "long" },
    allocation: { role: "PRIMARY", sizing: "FULL", reasons: ["rank #1", "secondary reason"] },
  });
  assert.deepEqual(withAlloc.allocation, { role: "PRIMARY", sizing: "FULL", reason: "rank #1" });
  const noAlloc = terminalPlayFromZeroDte({ ticker: "y", status: "OPEN", setup: { direction: "long" } });
  assert.equal(noAlloc.allocation, null);
});

test("0DTE adapter: allocation with empty reasons array → reason undefined (no crash on [0])", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", setup: { direction: "long" }, allocation: { role: "R", sizing: "S", reasons: [] } });
  assert.equal(p.allocation!.reason, undefined);
});

// ── status normalization: garbage → WATCH; case-insensitive ────────────────────────────
test("0DTE adapter: unrecognized status string normalizes to WATCH; lowercase status upcases", () => {
  const garbage = terminalPlayFromZeroDte({ ticker: "x", status: "banana", setup: { direction: "long" } });
  assert.equal(garbage.status, "WATCH");
  const lower = terminalPlayFromZeroDte({ ticker: "y", status: "open", setup: { direction: "long" } });
  assert.equal(lower.status, "OPEN");
});

test("0DTE adapter: always exitModel RATCHET and horizon ZERO_DTE; RATCHET progress present", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", live_pnl_pct: 25, entry_premium: 1, last_mark: 1.25, setup: { direction: "long" } });
  assert.equal(p.exitModel, "RATCHET");
  assert.equal(p.horizon, "ZERO_DTE");
  assert.ok(Math.abs(p.progress! - (25 + 50) / 150) < 1e-9); // RATCHET track filled from pnl
});

// ════════════════════════════════════════════════════════════════════════════════════
// managementFor — the full truth table (exit model × status × pnl band).
// ════════════════════════════════════════════════════════════════════════════════════

test("managementFor: TRIM status wins over EVERY pnl band and model", () => {
  for (const model of ["RATCHET", "SCALE_OUT", "PLAN"] as const) {
    for (const pnl of [-50, -45, 0, 89, 90, 200]) {
      assert.equal(managementFor(model, "TRIM", pnl).recommendation, "TRIM", `${model} TRIM @${pnl}`);
    }
  }
});

test("managementFor: RATCHET at ≥90 (non-TRIM status) → TRIM at the boundary, HOLD just below", () => {
  assert.equal(managementFor("RATCHET", "OPEN", 90).recommendation, "TRIM"); // boundary inclusive
  assert.equal(managementFor("RATCHET", "HOLD", 89).recommendation, "HOLD"); // just below
  // A non-RATCHET model does NOT auto-TRIM on a big winner (scale-out banks via tranches, not here).
  assert.equal(managementFor("SCALE_OUT", "OPEN", 95).recommendation, "HOLD");
  assert.equal(managementFor("PLAN", "OPEN", 300).recommendation, "HOLD");
});

test("managementFor: SELL at ≤−45 boundary; HOLD at −44; TRIM state still beats SELL", () => {
  assert.equal(managementFor("RATCHET", "OPEN", -45).recommendation, "SELL"); // boundary inclusive
  assert.equal(managementFor("RATCHET", "OPEN", -44).recommendation, "HOLD");
  assert.equal(managementFor("RATCHET", "TRIM", -50).recommendation, "TRIM"); // TRIM status precedence
});

test("managementFor: null pnl → treated as 0 → HOLD, RATCHET progress = 1/3", () => {
  const m = managementFor("RATCHET", "OPEN", null);
  assert.equal(m.recommendation, "HOLD");
  assert.ok(Math.abs(m.progress! - (0 + 50) / 150) < 1e-9);
});

test("managementFor: RATCHET progress clamps to [0,1] beyond −50%/+100%", () => {
  assert.equal(managementFor("RATCHET", "OPEN", -50).progress, 0);
  assert.equal(managementFor("RATCHET", "OPEN", -80).progress, 0); // clamped low
  assert.equal(managementFor("RATCHET", "OPEN", 100).progress, 1);
  assert.equal(managementFor("RATCHET", "OPEN", 250).progress, 1); // clamped high
  assert.equal(managementFor("SCALE_OUT", "OPEN", 50).progress, null); // no ratchet track
  assert.equal(managementFor("PLAN", "OPEN", 50).progress, null);
});

test("managementFor: recNote reflects the recommendation + model", () => {
  assert.match(managementFor("RATCHET", "OPEN", -50).recNote, /preserve capital/); // SELL
  assert.match(managementFor("SCALE_OUT", "TRIM", 10).recNote, /Bank a tranche/); // SCALE_OUT trim
  assert.match(managementFor("RATCHET", "TRIM", 10).recNote, /Take partial/); // ratchet trim
  assert.match(managementFor("RATCHET", "HOLD", 20).recNote, /In profit/); // HOLD in the green
  assert.match(managementFor("RATCHET", "HOLD", -10).recNote, /Managing to the plan/); // HOLD underwater
});

// ── Terminal v2 — trim-scale ladder routing, live greeks/executable, header badges ──

const TRIM_SCALE_LADDER = {
  policy: "trim_scale" as const,
  hard_stop_pct: -50,
  target_pct: 100,
  trim_levels: [
    { trigger_pct: 25, fraction: 1 / 3, premium: 2.5, fired: true },
    { trigger_pct: 50, fraction: 1 / 3, premium: 3.0, fired: false },
  ],
  runner_fraction: 1 / 3,
  stop_premium: 1.0,
  target_premium: 4.0,
  time_stop_et: "15:30",
};

test("0DTE adapter: a trim_scale frozen policy routes to SCALE_OUT + carries the real ladder", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "nvda", strike: 182, status: "OPEN", score: 88, live_pnl_pct: 30,
    entry_premium: 2.0, last_mark: 2.6, peak_premium: 2.6,
    setup: { direction: "long", dte: 0 },
    exit_policy: TRIM_SCALE_LADDER,
  });
  assert.equal(play.exitModel, "SCALE_OUT"); // NOT the old hard-coded RATCHET
  assert.equal(play.exitPolicy!.policy, "trim_scale");
  assert.equal(play.exitPolicy!.trim_levels[0]!.fired, true);
  assert.equal(play.exitPolicy!.trim_levels[1]!.fired, false);
  assert.equal(play.exitPolicy!.target_premium, 4.0);
});

test("0DTE adapter: a ratchet frozen policy (or none) keeps RATCHET single-track", () => {
  const ratchet = terminalPlayFromZeroDte({
    ticker: "amd", strike: 165, status: "OPEN", score: 70, live_pnl_pct: 10,
    entry_premium: 1.2, last_mark: 1.3,
    setup: { direction: "short", dte: 0 },
    exit_policy: { ...TRIM_SCALE_LADDER, policy: "ratchet" },
  });
  assert.equal(ratchet.exitModel, "RATCHET");
  assert.equal(ratchet.progress != null, true); // ratchet track position present

  const none = terminalPlayFromZeroDte({
    ticker: "amd", strike: 165, status: "OPEN", score: 70, live_pnl_pct: 10,
    entry_premium: 1.2, last_mark: 1.3, setup: { direction: "short", dte: 0 },
  });
  assert.equal(none.exitModel, "RATCHET"); // legacy row, no policy → unchanged
  assert.equal(none.exitPolicy, null);
});

test("0DTE adapter: maps live greeks, executable fill, mark honesty, and header badges", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "nvda", strike: 182, status: "OPEN", score: 88, live_pnl_pct: 30,
    entry_premium: 2.0, last_mark: 2.6, bid: 2.55, ask: 2.65, live_pnl_pct_exec: 27.5,
    greeks: { delta: 0.52, gamma: 0.06, theta: -0.18, vega: 0.11, iv: 0.44 },
    mark_as_of: "2026-07-25T14:00:00.000Z", mark_is_sync: false,
    discovery_origin: ["FLOW", "BREAKOUT"], tier: { tier: "A" }, confluence: 2,
    setup: { direction: "long", dte: 0 },
  });
  assert.equal(play.greeks!.theta, -0.18);
  assert.equal(play.execMark, 2.55); // sells into the bid, not the 2.60 mid
  assert.equal(play.execPnlPct, 27.5);
  assert.equal(play.markAsOf, "2026-07-25T14:00:00.000Z");
  assert.equal(play.markIsSync, false);
  assert.deepEqual(play.discoveryOrigin, ["FLOW", "BREAKOUT"]);
  assert.equal(play.tierLabel, "A");
  assert.equal(play.confluence, 2);
});

test("0DTE adapter: greeks/executable/badges are null-safe when absent (never fabricated)", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "spy", strike: 584, status: "WATCH", score: 60,
    setup: { direction: "long", dte: 0 },
  });
  assert.equal(play.greeks, null);
  assert.equal(play.execMark, null);
  assert.equal(play.execPnlPct, null);
  assert.equal(play.discoveryOrigin, null);
  assert.equal(play.tierLabel, null);
  assert.equal(play.confluence, null);
  assert.equal(play.scorecard, null);
});

test("0DTE adapter: one-sided book → executable fill null (mid-only, no fake fill)", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "nvda", strike: 182, status: "OPEN", score: 80, live_pnl_pct: 10,
    entry_premium: 2.0, last_mark: 2.2, ask: 2.3, bid: null, // one-sided
    setup: { direction: "long", dte: 0 },
  });
  assert.equal(play.execMark, null);
});

test("0DTE adapter: a CONDOR row is flagged isCondor and NEVER routes to the directional trim ladder", () => {
  // Even if the frozen policy says trim_scale, a credit condor must not draw the long-premium ladder.
  const condor = terminalPlayFromZeroDte({
    ticker: "spx", strike: 6300, status: "HOLD", score: 82, live_pnl_pct: 40,
    entry_premium: 4.2, last_mark: 2.4, is_condor: true,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    exit_policy: TRIM_SCALE_LADDER,
  });
  assert.equal(condor.isCondor, true);
  assert.equal(condor.exitModel, "RATCHET"); // NOT SCALE_OUT — the directional ladder is suppressed

  // Condor detected from the setup's play_type when the row lacks an explicit is_condor flag.
  const fromSetup = terminalPlayFromZeroDte({
    ticker: "spxw", status: "OPEN", score: 70,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    exit_policy: TRIM_SCALE_LADDER,
  });
  assert.equal(fromSetup.isCondor, true);
  assert.equal(fromSetup.exitModel, "RATCHET");

  // A directional trim_scale row is unaffected — still routes to SCALE_OUT + the real ladder.
  const directional = terminalPlayFromZeroDte({
    ticker: "nvda", status: "OPEN", score: 80, entry_premium: 2.0, last_mark: 2.6,
    setup: { direction: "long", dte: 0 }, exit_policy: TRIM_SCALE_LADDER,
  });
  assert.equal(directional.isCondor, null);
  assert.equal(directional.exitModel, "SCALE_OUT");
});
