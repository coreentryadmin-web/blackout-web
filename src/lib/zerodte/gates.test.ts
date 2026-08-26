import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// gates.ts is a pure leaf (type-only imports from ./board, ./intraday) — no
// mock.module scaffolding needed, unlike scan.test.ts's provider graph.
import {
  evaluateZeroDteGates,
  gateRejectionFor,
  MARKET_BIAS_MAX_AGE_MS,
  planQualityGateBlocks,
  refreshPlanQualityGateBlocks,
  refreshGovernorPremiumBudgetBlocks,
  confluenceFloorAt,
  scoreFloorForOrigins,
  ZERODTE_CONFLUENCE_MIN,
  ZERODTE_CONFLUENCE_MIN_EARLY,
  ZERODTE_SCORE_FLOOR,
  ZERODTE_SCORE_FLOOR_BREAKOUT,
  ZERODTE_SCORE_FLOOR_PIN,
  ZERODTE_SINGLE_RAIL_PRIME_MIN,
  isSingleRailWithoutFlow,
  getNullConfluencePassCount,
  LATE_AFTERNOON_BLOCK_ET_MINUTES,
  type ZeroDteGateInput,
} from "./gates";
import type { ContractPlan } from "./plan";
import { buildContractPlan, evaluateQuoteValidity, QUOTE_VALIDITY } from "./plan";
import type { ZeroDteConfluence } from "./confluence";
import { GOVERNOR_MAX_CONCURRENT_PLANS, GOVERNOR_MAX_PREMIUM_AT_RISK } from "./governor";

/** Minimal confluence read carrying `confirmations` (the only field G-12 reads). */
function confluence(confirmations: number): ZeroDteConfluence {
  return {
    score: confirmations,
    confirmations,
    timing_ok: true,
    early_window: false,
    vwap_ok: confirmations >= 1,
    market_ok: confirmations >= 2,
    tier: confirmations >= 2 ? "double" : "weak",
    label: `${confirmations} conf`,
  };
}

const NOW_MS = Date.parse("2026-07-13T15:00:00Z"); // 11:00 ET on the fixture date

/** Enterable plan — clears G-8/G-9 unless a test overrides it. */
const CLEAN_PLAN: ContractPlan = {
  occ: "O:QQQ260713P00500000",
  flow_avg_fill: 2,
  bid: 1.9,
  ask: 2.1,
  mark: 2,
  entry_max: 2,
  vs_flow_pct: 0,
  entry_status: "IN_RANGE",
  spread_pct: 10,
  illiquid: false,
  stop_premium: 1,
  target_premium: 4,
  time_stop_et: "15:30",
  underlying_target: null,
  underlying_invalid: null,
};

/** A mid-session, fully-aligned, fresh-bias input that clears every gate — each
 *  test flips exactly the dimension it exercises. Default confluence=2 matches the
 *  precision G-12 floor (2026-07-29); override with null / confluence(n) per case. */
function input(overrides: Partial<ZeroDteGateInput> = {}): ZeroDteGateInput {
  return {
    ticker: "QQQ",
    direction: "short",
    score: 70,
    nowEtMinutes: 11 * 60, // 11:00 ET
    nowMs: NOW_MS,
    bias: "down",
    biasAsOfMs: NOW_MS - 60_000, // 1-minute-old SPY bar — fresh
    governor: { open_plans: [], stops: [] },
    plan: CLEAN_PLAN,
    intradayConflict: false,
    halted: false,
    earnings: null,
    todayYmd: "2026-07-13",
    macroEvents: [],
    confluence: confluence(2),
    ...overrides,
  };
}

// ── G-1 · tape alignment ───────────────────────────────────────────────────────────

test("G-1: aligned with the tape (short on a down day) commits", () => {
  const v = evaluateZeroDteGates(input());
  assert.equal(v.verdict, "COMMIT");
  assert.deepEqual(v.blocks, []);
});

test("G-1: long against a down tape is BLOCKED (was only a -6 score dent)", () => {
  const v = evaluateZeroDteGates(input({ direction: "long", score: 93 }));
  assert.equal(v.verdict, "BLOCKED", "a 93-score counter-tape long must still block (7/13 SPY long)");
  assert.equal(v.blocks[0]!.code, "tape_alignment");
  assert.match(v.blocks[0]!.reason, /fights the DOWN market tape/);
});

test("G-1: short against an up tape is BLOCKED (mirror)", () => {
  const v = evaluateZeroDteGates(input({ bias: "up", direction: "short" }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "tape_alignment");
});

test("G-1: a flat tape has no directional conflict — commits either way", () => {
  assert.equal(evaluateZeroDteGates(input({ bias: "flat", direction: "long" })).verdict, "COMMIT");
  assert.equal(evaluateZeroDteGates(input({ bias: "flat", direction: "short" })).verdict, "COMMIT");
});

test("G-1 fail-closed: missing bias blocks a NEW commit, with its own distinct code", () => {
  const v = evaluateZeroDteGates(input({ bias: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");
  assert.match(v.blocks[0]!.reason, /fail closed/);
});

test("G-1 fail-closed: a stale bias (SPY bars stopped arriving) blocks like a missing one", () => {
  const staleMs = NOW_MS - MARKET_BIAS_MAX_AGE_MS - 1;
  const v = evaluateZeroDteGates(input({ biasAsOfMs: staleMs }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");

  // Exactly at the age limit is still fresh — the boundary is exclusive.
  const edge = evaluateZeroDteGates(input({ biasAsOfMs: NOW_MS - MARKET_BIAS_MAX_AGE_MS }));
  assert.equal(edge.verdict, "COMMIT");
});

test("G-1 fail-closed: bias present but its freshness unknown (no bar timestamp) blocks", () => {
  const v = evaluateZeroDteGates(input({ biasAsOfMs: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");
});

// ── G-1 bypass · single-name stocks skip tape alignment entirely ──────────────

test("G-1 bypass: single-name counter-tape long commits (tape alignment is index-ETF only)", () => {
  const v = evaluateZeroDteGates(input({ ticker: "NVDA", direction: "long" }));
  assert.equal(v.verdict, "COMMIT", "single-name stock should bypass tape alignment");
  assert.deepEqual(v.blocks.filter(b => b.code === "tape_alignment" || b.code === "no_market_bias"), []);
});

test("G-1 bypass: single-name with missing bias commits (no fail-closed for non-index)", () => {
  const v = evaluateZeroDteGates(input({ ticker: "AAPL", direction: "long", bias: null }));
  assert.equal(v.verdict, "COMMIT");
  assert.deepEqual(v.blocks.filter(b => b.code === "no_market_bias"), []);
});

test("G-1 bypass: single-name with stale bias commits (staleness irrelevant for non-index)", () => {
  const staleMs = NOW_MS - MARKET_BIAS_MAX_AGE_MS - 1;
  const v = evaluateZeroDteGates(input({ ticker: "TSLA", direction: "short", biasAsOfMs: staleMs }));
  assert.equal(v.verdict, "COMMIT");
  assert.deepEqual(v.blocks.filter(b => b.code === "no_market_bias"), []);
});

// ── G-2 · opening window (worst first 30 min, unlock 10:00 — user-authorized 2026-07-23) ──

test("G-2: an aligned setup before 10:00 ET is BLOCKED, with the unlock time on the card", () => {
  const v = evaluateZeroDteGates(input({ nowEtMinutes: 9 * 60 + 40 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.length, 1, "only the window blocks — alignment is clean");
  assert.equal(v.blocks[0]!.code, "opening_window");
  assert.equal(v.blocks[0]!.unlock_et, "10:00 ET");
});

test("G-2: 9:55 is still inside the (extended) window — blocked", () => {
  // The 2026-07-23 evidence move: 9:45 was the WORST entry time (−12% EV), so the unlock
  // pushed from 9:45 → 10:00. A 9:55 setup that used to commit is now held to 10:00.
  assert.equal(evaluateZeroDteGates(input({ nowEtMinutes: 9 * 60 + 55 })).verdict, "BLOCKED");
});

test("G-2: exactly 10:00 ET unlocks (boundary inclusive)", () => {
  const v = evaluateZeroDteGates(input({ nowEtMinutes: 10 * 60 }));
  assert.equal(v.verdict, "COMMIT");
});

test("G-2: 10:20 is past the window — commits (the 10:00–10:30 band is the calibration loop's to judge)", () => {
  assert.equal(evaluateZeroDteGates(input({ nowEtMinutes: 10 * 60 + 20 })).verdict, "COMMIT");
});

test("G-1 + G-2: a counter-tape long at 09:40 collects BOTH blocks (all reasons visible)", () => {
  const v = evaluateZeroDteGates(input({ direction: "long", nowEtMinutes: 9 * 60 + 40 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(
    v.blocks.map((b) => b.code),
    ["tape_alignment", "opening_window"]
  );
});

// ── G-14 · late-afternoon block (no new commits after 3:30 PM ET) ─────────────────

test("G-14: directional setup at 15:30 ET is BLOCKED", () => {
  const v = evaluateZeroDteGates(input({ nowEtMinutes: 15 * 60 + 30 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.ok(v.blocks.some((b) => b.code === "late_afternoon"));
  assert.equal(LATE_AFTERNOON_BLOCK_ET_MINUTES, 15 * 60 + 30);
});

test("G-14: 15:29 commits — boundary is exclusive (last minute before the block)", () => {
  assert.equal(evaluateZeroDteGates(input({ nowEtMinutes: 15 * 60 + 29 })).verdict, "COMMIT");
});

test("G-14: 14:00 still commits (window now runs through 15:29 ET)", () => {
  assert.equal(evaluateZeroDteGates(input({ nowEtMinutes: 14 * 60 })).verdict, "COMMIT");
});

test("G-14: 15:45 is still BLOCKED after the cutoff", () => {
  const v = evaluateZeroDteGates(input({ nowEtMinutes: 15 * 60 + 45 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.ok(v.blocks.some((b) => b.code === "late_afternoon"));
});


test("scoreFloorForOrigins: all rails share 65 floor; FLOW+BREAKOUT stays FLOW strict", () => {
  assert.equal(scoreFloorForOrigins(["FLOW"]), ZERODTE_SCORE_FLOOR);
  assert.equal(scoreFloorForOrigins(["FLOW", "BREAKOUT"]), ZERODTE_SCORE_FLOOR);
  assert.equal(scoreFloorForOrigins(["BREAKOUT"]), ZERODTE_SCORE_FLOOR_BREAKOUT);
  assert.equal(scoreFloorForOrigins(["PIN"]), ZERODTE_SCORE_FLOOR_PIN);
  assert.equal(ZERODTE_SCORE_FLOOR_BREAKOUT, 65);
  assert.equal(ZERODTE_SCORE_FLOOR_PIN, 65);
  assert.equal(scoreFloorForOrigins([]), ZERODTE_SCORE_FLOOR);
});

test("G-3: BREAKOUT at score 65 clears unified floor; G-17 blocks solo rail below 75", () => {
  const brk = evaluateZeroDteGates(input({ score: 65, discovery_origin: ["BREAKOUT"] }));
  assert.equal(brk.verdict, "BLOCKED");
  assert.ok(!brk.blocks.some((b) => b.code === "score_floor"));
  assert.ok(brk.blocks.some((b) => b.code === "single_rail_corroboration"));
  const brkLow = evaluateZeroDteGates(input({ score: 64, discovery_origin: ["BREAKOUT"] }));
  assert.equal(brkLow.verdict, "BLOCKED");
  assert.ok(brkLow.blocks.some((b) => b.code === "score_floor"));
  const flow = evaluateZeroDteGates(input({ score: 64, discovery_origin: ["FLOW"] }));
  assert.equal(flow.verdict, "BLOCKED");
  assert.ok(flow.blocks.some((b) => b.code === "score_floor"));
  assert.equal(
    evaluateZeroDteGates(input({ score: 75, discovery_origin: ["BREAKOUT"] })).verdict,
    "COMMIT",
  );
  assert.equal(
    evaluateZeroDteGates(input({ score: 65, discovery_origin: ["FLOW"] })).verdict,
    "COMMIT",
  );
});


test("G-15 removed: ONE_DTE commits (Monday equity starvation fix)", () => {
  const one = evaluateZeroDteGates(input({ contractHorizon: "ONE_DTE" }));
  assert.equal(one.verdict, "COMMIT", "ONE_DTE is a same-day horizon and must commit");
  assert.ok(!one.blocks.some((b) => b.code === "not_zero_dte"));
  assert.equal(evaluateZeroDteGates(input({ contractHorizon: "ZERO_DTE" })).verdict, "COMMIT");
  assert.equal(evaluateZeroDteGates(input({})).verdict, "COMMIT", "absent horizon = no-op (legacy)");
});

test("G-14: condor at 15:15 is NOT blocked (condors benefit from late-session theta)", () => {
  const v = evaluateZeroDteGates(input({
    nowEtMinutes: 15 * 60 + 15,
    play_type: "CONDOR",
    direction: "short",
    condorPlan: {
      ticker: "SPY",
      expiry: "2026-07-13",
      short_call: 550, long_call: 555, short_put: 490, long_put: 485,
      net_credit: 1.2, max_loss: 3.8, wing_width: 5,
      credit_pct: 24, short_call_bid: 0.7, short_put_bid: 0.5,
      long_call_ask: 0.2, long_put_ask: 0.1,
      per_leg_spread_tax_pct: 8,
      underlying_price: 520,
      short_call_delta: -0.15, short_put_delta: 0.15,
    },
  }));
  const codes = v.blocks.map(b => b.code);
  assert.ok(!codes.includes("late_afternoon"), "condor must be exempt from late-afternoon gate");
});

// ── G-3 · score floor ──────────────────────────────────────────────────────────────

test("G-3: score 64 blocks, 65 commits (FLOW default floor)", () => {
  const blocked = evaluateZeroDteGates(input({ score: 64 }));
  assert.equal(blocked.verdict, "BLOCKED");
  assert.equal(blocked.blocks[0]!.code, "score_floor");
  assert.equal(blocked.blocks[0]!.threshold, 65);
  assert.match(blocked.blocks[0]!.reason, /65 commit floor/);

  assert.equal(evaluateZeroDteGates(input({ score: 65 })).verdict, "COMMIT");
});

test("G-3: judged on the POST-edge-layer score — 7/13's INTC short (61) blocks even though aligned and mid-day", () => {
  const v = evaluateZeroDteGates(input({ ticker: "INTC", score: 61, nowEtMinutes: 12 * 60 + 51 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["score_floor"]);
});

test("G-17: BREAKOUT-only at 68 blocks; 75+ commits; FLOW+BREAKOUT at 68 commits", () => {
  assert.equal(isSingleRailWithoutFlow(["BREAKOUT"]), true);
  assert.equal(isSingleRailWithoutFlow(["FLOW", "BREAKOUT"]), false);
  assert.equal(isSingleRailWithoutFlow(["BREAKOUT", "PIN"]), false);
  assert.equal(ZERODTE_SINGLE_RAIL_PRIME_MIN, 75);

  const soloMid = evaluateZeroDteGates(
    input({ score: 68, discovery_origin: ["BREAKOUT"], nowEtMinutes: 12 * 60 })
  );
  assert.equal(soloMid.verdict, "BLOCKED");
  assert.ok(soloMid.blocks.some((b) => b.code === "single_rail_corroboration"));

  const soloPrime = evaluateZeroDteGates(
    input({ score: 75, discovery_origin: ["BREAKOUT"], nowEtMinutes: 12 * 60 })
  );
  assert.equal(soloPrime.verdict, "COMMIT");

  const corroborated = evaluateZeroDteGates(
    input({ score: 68, discovery_origin: ["FLOW", "BREAKOUT"], nowEtMinutes: 12 * 60 })
  );
  assert.equal(corroborated.verdict, "COMMIT");
  assert.ok(!corroborated.blocks.some((b) => b.code === "single_rail_corroboration"));
});

// ── G-5 · session governor (wiring — the rules themselves live in governor.test.ts) ─

test("G-5: unreadable governor state fails closed with gate_context_unavailable", () => {
  const v = evaluateZeroDteGates(input({ governor: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["gate_context_unavailable"]);
});

test("G-5: three stopped plays halt every further commit for the session", () => {
  const stops = [
    { ticker: "SPY", direction: "long" as const, at_ms: null },
    { ticker: "MU", direction: "long" as const, at_ms: null },
    { ticker: "AMD", direction: "long" as const, at_ms: null },
  ];
  const v = evaluateZeroDteGates(input({ governor: { open_plans: [], stops } }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["governor_session_stops"]);
});

test("G-5: committedThisCycle counts toward the concurrency cap within one scan pass", () => {
  const governor = {
    open_plans: [
      { ticker: "TSLA", direction: "short" as const },
      { ticker: "META", direction: "long" as const },
      { ticker: "MSFT", direction: "short" as const },
    ],
    stops: [],
  };
  // Under the configured ceiling → COMMIT
  const under = Array.from({ length: GOVERNOR_MAX_CONCURRENT_PLANS - governor.open_plans.length - 1 }, (_, i) => ({
    ticker: `C${i}`,
    direction: "long" as const,
  }));
  assert.equal(
    evaluateZeroDteGates(input({ governor, committedThisCycle: under })).verdict,
    "COMMIT"
  );
  // Fill exactly to the ceiling via committedThisCycle → BLOCKED
  const atCap = Array.from({ length: GOVERNOR_MAX_CONCURRENT_PLANS - governor.open_plans.length }, (_, i) => ({
    ticker: `C${i}`,
    direction: "long" as const,
  }));
  const v = evaluateZeroDteGates(input({ governor, committedThisCycle: atCap }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["governor_max_concurrent"]);
});

test("G-5/B-3: a commit accepted earlier in the SAME cycle also anchors the correlated-conflict check", () => {
  // Cycle accepts SPY long first; a QQQ short later in the same pass must block
  // even though the ledger snapshot predates both.
  const v = evaluateZeroDteGates(
    input({
      ticker: "QQQ",
      direction: "short",
      governor: { open_plans: [], stops: [] },
      committedThisCycle: [{ ticker: "SPY", direction: "long" }],
    })
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["correlated_conflict"]);
});

// ── G-4 · VIX regime throttle (HARD GATE — promoted from calibration 2026-07-16) ────

test("G-4: normal VIX (<17) commits freely, calibration tier logged", () => {
  const normal = evaluateZeroDteGates(input({ vixDayOpen: 16.32 }));
  assert.equal(normal.verdict, "COMMIT");
  assert.equal(normal.calibration.g4_vix.tier, "normal");
  assert.equal(normal.calibration.g4_vix.would_block, false);
});

test("G-4: elevated VIX tape-aligned score 65–74 commits (G-1 already blocks counter-tape)", () => {
  const aligned = evaluateZeroDteGates(input({ vixDayOpen: 18, score: 70 }));
  assert.equal(aligned.verdict, "COMMIT");
  assert.equal(aligned.calibration.g4_vix.would_block, false);
});

test("G-4: elevated VIX with flat tape uses the standard 65 floor (flat = no directional opposition)", () => {
  // Flat tape clears G-1 (no counter-tape fight), so the elevated regime keeps the 65 floor.
  const flat70 = evaluateZeroDteGates(input({ vixDayOpen: 18, score: 70, bias: "flat" }));
  assert.equal(flat70.verdict, "COMMIT");
  assert.equal(flat70.calibration.g4_vix.tier, "elevated");
  assert.equal(flat70.calibration.g4_vix.would_block, false);
  // Null bias (unknown tape — stale or unavailable) still requires 75 (belt-and-suspenders).
  const null64 = evaluateZeroDteGates(input({ vixDayOpen: 18, score: 64, bias: null }));
  assert.equal(null64.verdict, "BLOCKED");
  assert.equal(null64.blocks.some((b) => b.code === "vix_elevated"), true);
  assert.equal(null64.calibration.g4_vix.would_block, true);
});

test("G-4: elevated VIX (>=17) with score >= 75 clears", () => {
  const strong = evaluateZeroDteGates(input({ vixDayOpen: 18, score: 80 }));
  assert.equal(strong.verdict, "COMMIT");
  assert.equal(strong.calibration.g4_vix.would_block, false, "aligned + score >= 75 clears");
});

test("G-4: extreme VIX (>=20) blocks single names outright", () => {
  const nvda = evaluateZeroDteGates(input({ ticker: "NVDA", direction: "short", vixDayOpen: 22, score: 90 }));
  assert.equal(nvda.verdict, "BLOCKED");
  assert.equal(nvda.blocks.some((b) => b.code === "vix_extreme"), true);
  assert.match(nvda.blocks.find((b) => b.code === "vix_extreme")!.reason, /single-name/);
  assert.equal(nvda.calibration.g4_vix.would_block, true);
});

test("G-4: extreme VIX (>=20) lets index/ETF products through (half-size in calibration)", () => {
  const qqq = evaluateZeroDteGates(input({ vixDayOpen: 22, score: 90 }));
  assert.equal(qqq.verdict, "COMMIT");
  assert.equal(qqq.calibration.g4_vix.tier, "extreme");
  assert.equal(qqq.calibration.g4_vix.would_halve_size, true);
});

test("G-4: unknown VIX (not attempted) does not block — a caller that omits VIX is unaffected", () => {
  // No vixUnavailable signal → the Phase-0 fail-closed path never fires (back-compat).
  const v = evaluateZeroDteGates(input({ vixDayOpen: null }));
  assert.equal(v.calibration.g4_vix.tier, "unknown");
  assert.equal(v.calibration.g4_vix.would_block, false);
  assert.equal(v.verdict, "COMMIT");
});

// ── G-4 · VIX fail-CLOSED for fresh commits (Phase-0 firewall) ──────────────────────

test("G-4 fail-closed: attempted-but-unavailable VIX blocks a fresh NON-index commit (a present VIX ≥20 could have blocked it outright)", () => {
  const v = evaluateZeroDteGates(input({ ticker: "NVDA", direction: "short", vixDayOpen: null, vixUnavailable: true }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "vix_unavailable"), true);
  assert.match(v.blocks.find((b) => b.code === "vix_unavailable")!.reason, /VIX read unavailable/);
});

test("G-4 fail-closed: unavailable VIX does NOT block an index/ETF whose score clears the elevated floor (no spurious empty)", () => {
  // QQQ (index) tape-aligned short at 80 ≥ 75: no present VIX regime could have blocked it,
  // so an unavailable VIX must not either.
  const strong = evaluateZeroDteGates(input({ ticker: "QQQ", direction: "short", score: 80, vixDayOpen: null, vixUnavailable: true }));
  assert.equal(strong.verdict, "COMMIT");
  assert.equal(strong.blocks.some((b) => b.code === "vix_unavailable"), false);
  // Tape-aligned index at 70 clears too (aligned elevated floor is 65, G-3 guarantees ≥65).
  const aligned = evaluateZeroDteGates(input({ ticker: "QQQ", direction: "short", score: 70, vixDayOpen: null, vixUnavailable: true }));
  assert.equal(aligned.verdict, "COMMIT");
  assert.equal(aligned.blocks.some((b) => b.code === "vix_unavailable"), false);
});

test("G-4 fail-closed: unavailable VIX does NOT block an index/ETF with flat tape above the standard 65 floor (flat = aligned)", () => {
  // Flat tape is treated as aligned, so the 65 floor applies — 70 >= 65 → no present VIX could block.
  const v = evaluateZeroDteGates(input({ ticker: "QQQ", direction: "short", score: 70, bias: "flat", vixDayOpen: null, vixUnavailable: true }));
  assert.equal(v.verdict, "COMMIT");
  assert.equal(v.blocks.some((b) => b.code === "vix_unavailable"), false);
  // Null bias (unknown tape) at 70 < 75 → DOES block (belt-and-suspenders for unknown tape).
  const nullBias = evaluateZeroDteGates(input({ ticker: "QQQ", direction: "short", score: 70, bias: null, vixDayOpen: null, vixUnavailable: true }));
  assert.equal(nullBias.verdict, "BLOCKED");
  assert.equal(nullBias.blocks.some((b) => b.code === "vix_unavailable"), true);
});

test("G-4 fail-closed: a PRESENT VIX ignores the unavailable signal entirely (normal regime path runs)", () => {
  // vixUnavailable set but a real VIX present → the present-VIX branch runs; no vix_unavailable.
  const v = evaluateZeroDteGates(input({ ticker: "NVDA", direction: "short", vixDayOpen: 16, vixUnavailable: true }));
  assert.equal(v.verdict, "COMMIT");
  assert.equal(v.blocks.some((b) => b.code === "vix_unavailable"), false);
  assert.equal(v.calibration.g4_vix.tier, "normal");
});

// ── G-7 · macro fail-CLOSED for fresh commits (Phase-0 firewall) ────────────────────

test("G-7 fail-closed: a FAILED macro fetch blocks a fresh commit (can't rule out a CPI/FOMC/NFP window)", () => {
  const v = evaluateZeroDteGates(input({ macroUnavailable: true }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "macro_unavailable"), true);
  assert.match(v.blocks.find((b) => b.code === "macro_unavailable")!.reason, /Macro calendar unavailable/);
});

test("G-7 fail-closed: 'fetched, zero events' (empty array, macroUnavailable NOT set) does NOT block", () => {
  // The everyday case — a clean macro read that found nothing. Must commit freely.
  const v = evaluateZeroDteGates(input({ macroEvents: [], macroUnavailable: false }));
  assert.equal(v.verdict, "COMMIT");
  assert.equal(v.blocks.some((b) => b.code === "macro_unavailable"), false);
});

// ── G-6 · cross-system conflict (HARD GATE — promoted from calibration 2026-07-16) ──

test("G-6: opposing Night Hawk's take with score < 65 BLOCKS (was calibration-only)", () => {
  const v = evaluateZeroDteGates(
    input({
      ticker: "META",
      direction: "short",
      score: 60,
      nighthawkTake: { direction: "long", edition_for: "2026-07-10" },
    })
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "cross_system_conflict"), true);
  assert.match(
    v.blocks.find((b) => b.code === "cross_system_conflict")!.reason,
    /Night Hawk/
  );
  assert.equal(v.calibration.g6_conflict.conflict, true);
  assert.deepEqual(v.calibration.g6_conflict.against, ["nighthawk_edition"]);
  assert.equal(v.calibration.g6_conflict.would_block, true);
});

test("G-6: opposing the live Slayer play on an SPX-correlated ticker BLOCKS at score < 65", () => {
  const slayerLive = { direction: "long" as const };
  const spy = evaluateZeroDteGates(input({ ticker: "SPY", direction: "short", score: 60, slayerLive }));
  assert.equal(spy.verdict, "BLOCKED");
  assert.equal(spy.blocks.some((b) => b.code === "cross_system_conflict"), true);
  assert.equal(spy.calibration.g6_conflict.conflict, true);
  assert.deepEqual(spy.calibration.g6_conflict.against, ["spx_slayer"]);
});

test("G-6: single-name short is NOT correlated exposure to Slayer's SPX book — no conflict", () => {
  const slayerLive = { direction: "long" as const };
  const intc = evaluateZeroDteGates(input({ ticker: "INTC", direction: "short", slayerLive }));
  assert.equal(intc.calibration.g6_conflict.conflict, false);
  assert.equal(intc.verdict, "COMMIT");
});

test("G-6: same direction as Slayer — no conflict, commits freely", () => {
  const slayerLive = { direction: "long" as const };
  const qqqLong = evaluateZeroDteGates(input({ ticker: "QQQ", direction: "long", bias: "up", slayerLive }));
  assert.equal(qqqLong.calibration.g6_conflict.conflict, false);
  assert.equal(qqqLong.verdict, "COMMIT");
});

test("G-6: score >= 65 overrides the conflict — CONFLICT still flagged but commits", () => {
  const v = evaluateZeroDteGates(
    input({
      ticker: "META",
      direction: "short",
      score: 85,
      nighthawkTake: { direction: "long", edition_for: "2026-07-10" },
    })
  );
  assert.equal(v.verdict, "COMMIT");
  assert.equal(v.calibration.g6_conflict.conflict, true);
  assert.equal(v.calibration.g6_conflict.would_block, false);
});

import { recentNighthawkTake } from "./gates";

test("recentNighthawkTake: recency-bounded (<=5 days) and strictly directional", () => {
  const take = { direction: "long", edition_for: "2026-07-10" };
  assert.deepEqual(recentNighthawkTake(take, "2026-07-13"), {
    direction: "long",
    edition_for: "2026-07-10",
  });
  assert.equal(recentNighthawkTake(take, "2026-07-20"), null, "a week-old take is history, not context");
  assert.equal(recentNighthawkTake({ direction: "mixed", edition_for: "2026-07-13" }, "2026-07-13"), null);
  assert.equal(recentNighthawkTake(null, "2026-07-13"), null);
});

test("calibration record carries the C-2 context columns (score, bias, ET time bucket)", () => {
  const v = evaluateZeroDteGates(input({ score: 71.4, nowEtMinutes: 12 * 60 + 40, vixDayOpen: 16.32 }));
  assert.equal(v.calibration.score_at_commit, 71);
  assert.equal(v.calibration.market_bias, "down");
  assert.equal(v.calibration.committed_at_et, "12:40");
});

// ── rejection-row bridge ───────────────────────────────────────────────────────────

const rejectionSource = {
  ticker: "SPY",
  direction: "long" as const,
  gross_premium: 2_400_000,
  aggression: 0.62,
  side_dominance: 0.81,
  otm_pct: 0.4,
  prints: 12,
  first_seen: "2026-07-13T13:55:00Z",
  last_seen: "2026-07-13T13:58:00Z",
};

test("gateRejectionFor: one row per blocked setup — primary code, ALL reasons concatenated", () => {
  // 09:40 counter-tape long → two blocks (G-1 + G-2), one durable row.
  const v = evaluateZeroDteGates(
    input({ ticker: "SPY", direction: "long", bias: "down", nowEtMinutes: 9 * 60 + 40 })
  );
  const row = gateRejectionFor(rejectionSource, v);
  assert.equal(row.ticker, "SPY");
  assert.equal(row.gate_failed, "tape_alignment", "primary = first-evaluated failing gate");
  assert.match(String(row.reason), /fights the DOWN market tape/);
  assert.match(String(row.reason), /10:00 ET/, "second block's sentence rides the same row");
  // Evidence-gate columns carry through so both gate families are comparable rows.
  assert.equal(row.gross_premium, 2_400_000);
  assert.equal(row.direction, "long");
  assert.equal(row.prints, 12);
});

test("gateRejectionFor: a null verdict (gate context unreadable) is itself a fail-closed row", () => {
  const row = gateRejectionFor(rejectionSource, null);
  assert.equal(row.gate_failed, "gate_context_unavailable");
  assert.match(String(row.reason), /fail closed/);
});

// ── G-7..G-11 (precision gates, 2026-07-18 audit) ────────────────────────────────

test("G-8: MOVED plan blocks even when every other gate clears", () => {
  const moved: ContractPlan = {
    ...CLEAN_PLAN,
    entry_status: "MOVED",
    vs_flow_pct: 40,
    mark: 2.8,
  };
  const v = evaluateZeroDteGates(input({ plan: moved }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "plan_moved"), true);
});

test("G-9: illiquid spread blocks", () => {
  const illiquid: ContractPlan = { ...CLEAN_PLAN, spread_pct: 22, illiquid: true };
  const v = evaluateZeroDteGates(input({ plan: illiquid }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "plan_illiquid"), true);
});

test("G-9: missing plan blocks (no quote + no fill)", () => {
  const v = evaluateZeroDteGates(input({ plan: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "plan_no_quote"), true);
});

test("G-10: intraday_conflict is score-only (no hard block)", () => {
  const v = evaluateZeroDteGates(input({ intradayConflict: true }));
  assert.equal(v.verdict, "COMMIT");
  assert.equal(v.blocks.some((b) => b.code === "intraday_conflict"), false);
});

test("G-11: halted underlying blocks", () => {
  const v = evaluateZeroDteGates(input({ halted: true }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "halted"), true);
});

test("G-11: earnings reporter blocks", () => {
  const v = evaluateZeroDteGates(
    input({
      earnings: { when: "afterhours", report_date: "2026-07-13", expected_move_pct: 8 },
    })
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "earnings"), true);
});

// ── G-11 earnings fail-CLOSED (D1) — a FAILED earnings read must NOT look like "no earnings".
// Before the fix, scan.ts collapsed timeout/null/throw into an empty map, so `earnings` was
// null and the gate committed. Now scan.ts sets earningsUnavailable=true on a failed read and
// G-11 holds the fresh commit closed. These three cases pin the three-outcome contract.

test("G-11 D1: FAILED earnings read (earningsUnavailable) fails a fresh commit closed", () => {
  // No earnings flag present (failed read yields an empty map) — the OLD code committed here.
  const v = evaluateZeroDteGates(input({ earnings: null, earningsUnavailable: true }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "earnings_unavailable"), true);
  assert.match(
    v.blocks.find((b) => b.code === "earnings_unavailable")!.reason,
    /Earnings feed unavailable/
  );
});

test("G-11 D1: SUCCESSFUL earnings read with no reporter still COMMITS (not over-blocked)", () => {
  // Read succeeded, no candidate reports today → earnings null AND earningsUnavailable unset/false.
  const commits = evaluateZeroDteGates(input({ earnings: null, earningsUnavailable: false }));
  assert.equal(commits.verdict, "COMMIT");
  assert.equal(commits.blocks.some((b) => b.code === "earnings_unavailable"), false);
  // Field entirely absent (caller never set it) must behave identically — no spurious block.
  const absent = evaluateZeroDteGates(input({ earnings: null }));
  assert.equal(absent.verdict, "COMMIT");
  assert.equal(absent.blocks.some((b) => b.code === "earnings_unavailable"), false);
});

test("G-11 D1: present earnings flag still fires `earnings` (unregressed by the fail-closed add)", () => {
  // Reporting-today AND an unavailable flag: the present-and-reporting block wins, and the
  // fail-closed branch (else-if) never double-fires.
  const v = evaluateZeroDteGates(
    input({
      earnings: { when: "premarket", report_date: "2026-07-13", expected_move_pct: 8 },
      earningsUnavailable: true,
    })
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "earnings"), true);
  assert.equal(v.blocks.some((b) => b.code === "earnings_unavailable"), false);
});

// ── G-11 halt-feed fail-CLOSED (D2) — a COLD halt feed (empty store) must NOT look like "no halts".
// Before the fix, scan.ts read the board halt with failClosedOnStale:false, so a dark/dead halt
// socket left the store empty and a HALTED underlying could commit a fresh 0DTE. Now scan.ts also
// surfaces haltFeedStale=true (both UW+LULD halt sources cold) and G-11 holds the fresh commit
// closed under a distinct `halt_feed_stale` code. These cases pin the contract at the gate.

test("G-11 D2: cold halt feed (haltFeedStale) fails a fresh commit closed", () => {
  // No ACTIVE halt on this name (store empty) — the OLD code committed here.
  const v = evaluateZeroDteGates(input({ halted: false, haltFeedStale: true }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "halt_feed_stale"), true);
  assert.match(
    v.blocks.find((b) => b.code === "halt_feed_stale")!.reason,
    /halt feed cold/i
  );
});

test("G-11 D2: healthy feed (haltFeedStale false/absent) still COMMITS — NO board starvation", () => {
  // The critical safety property: on a healthy socket (flow/price/tide streaming) the halt source
  // reads FRESH via the cross-channel freshest-message proxy, so haltFeedStale is false and a
  // quiet-halt session commits exactly as before. A stale halt CHANNEL must never empty the board.
  const explicitFalse = evaluateZeroDteGates(input({ halted: false, haltFeedStale: false }));
  assert.equal(explicitFalse.verdict, "COMMIT");
  assert.equal(explicitFalse.blocks.some((b) => b.code === "halt_feed_stale"), false);
  // Field entirely absent (caller never set it) must behave identically — no spurious block.
  const absent = evaluateZeroDteGates(input({ halted: false }));
  assert.equal(absent.verdict, "COMMIT");
  assert.equal(absent.blocks.some((b) => b.code === "halt_feed_stale"), false);
});

test("G-11 D2: an ACTIVE halt still fires `halted` and never double-fires halt_feed_stale", () => {
  // Active halt AND a cold feed: the active-halt block wins (else-if), so exactly one G-11 halt
  // block fires and it is the specific `halted` code, not the data-plane `halt_feed_stale`.
  const v = evaluateZeroDteGates(input({ halted: true, haltFeedStale: true }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "halted"), true);
  assert.equal(v.blocks.some((b) => b.code === "halt_feed_stale"), false);
});

test("G-7: macro hard-block during CPI window", () => {
  const v = evaluateZeroDteGates(
    input({
      nowEtMinutes: 8 * 60 + 25,
      macroEvents: [{ event: "CPI", time: "08:30", date: "2026-07-13", country: "US" }],
    })
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "macro_hard_block"), true);
});

test("planQualityGateBlocks: exported helper matches gate evaluation", () => {
  assert.deepEqual(planQualityGateBlocks(CLEAN_PLAN), []);
  assert.equal(planQualityGateBlocks(null)[0]!.code, "plan_no_quote");
});

test("refreshPlanQualityGateBlocks: drops stale plan_no_quote after deferred attach", () => {
  const stale = evaluateZeroDteGates(
    input({ plan: null, deferPlanQualityGates: true, score: 88 })
  );
  assert.equal(stale.verdict, "COMMIT");
  assert.equal(stale.blocks.some((b) => b.code === "plan_no_quote"), false);

  const refreshed = refreshPlanQualityGateBlocks(stale, CLEAN_PLAN);
  assert.equal(refreshed.verdict, "COMMIT");
  assert.equal(refreshed.blocks.some((b) => b.code === "plan_no_quote"), false);

  const blocked = refreshPlanQualityGateBlocks(stale, null);
  assert.equal(blocked.verdict, "BLOCKED");
  assert.equal(blocked.blocks.some((b) => b.code === "plan_no_quote"), true);
});

// Bug found 2026-08-26 alongside the plan_no_quote fix: G-5's premium-budget check runs with
// entry_premium computed from the (still-null, deferred) plan, so a thesis-first candidate's
// own premium contribution was permanently 0 unless refreshed after the real plan attaches.
// Currently dormant (GOVERNOR_ENFORCE_PREMIUM_BUDGET defaults false) — `enforce: true` is
// passed explicitly here since the flag is read once at module load and cannot be flipped
// at runtime by a test.
test("refreshGovernorPremiumBudgetBlocks: recomputes the budget using the REAL post-attach premium, not the stale plan=null 0", () => {
  const base = evaluateZeroDteGates(input({ plan: null, score: 88 }));
  assert.equal(base.blocks.some((b) => b.code === "governor_premium_budget"), false);

  // premiumAtRisk sits just under the cap; only a real (now-attached) entry_premium pushes
  // it over — the stale plan=null (entryPremium null → 0) computation must NOT block.
  const almostAtCap = GOVERNOR_MAX_PREMIUM_AT_RISK - 200;
  const staleNull = refreshGovernorPremiumBudgetBlocks(base, null, almostAtCap, true);
  assert.equal(staleNull.blocks.some((b) => b.code === "governor_premium_budget"), false, "null entry_premium (the stale value) must not block");

  const withRealPremium = refreshGovernorPremiumBudgetBlocks(base, 500, almostAtCap, true);
  assert.equal(withRealPremium.verdict, "BLOCKED");
  assert.ok(withRealPremium.blocks.some((b) => b.code === "governor_premium_budget"));

  // With enforcement OFF (the real, current production default) the same over-cap premium
  // never blocks — confirms this stays a dormant MEASURE path until the flag is flipped on.
  const enforcementOff = refreshGovernorPremiumBudgetBlocks(base, 500, almostAtCap, false);
  assert.equal(enforcementOff.blocks.some((b) => b.code === "governor_premium_budget"), false);
});

test("deferPlanQualityGates: evaluateZeroDteGates skips plan blocks when plan is null", () => {
  const v = evaluateZeroDteGates(input({ plan: null, deferPlanQualityGates: true, score: 88 }));
  assert.equal(v.verdict, "COMMIT");
  assert.equal(v.blocks.some((b) => b.code === "plan_no_quote"), false);
});

// ── WS-04 · Malformed-quote validation gate (fail-closed) ─────────────────────────
// Each case drives the REAL plan builder (buildContractPlan) with a malformed book and
// asserts it is BLOCKED with the distinct plan_quote_invalid / plan_quote_stale code.
// Pre-fix these all PASSED as liquid (spread_pct null/negative/zero slipped under >15).

/** Common builder args — a mid-session long whose only malformed dimension is the quote. */
const QUOTE_BASE = {
  occ: "O:QQQ260713C00500000",
  direction: "long" as const,
  price: 500,
  flowAvgFill: 2,
  keySupports: [] as number[],
  keyResistances: [] as number[],
  vwap: null,
};

test("WS-04 (1): zero-bid quote → blocked (plan_quote_invalid / zero_bid)", () => {
  // bid=0 made spread_pct null → legacy `illiquid` false → PASSED. Now fails closed.
  const plan = buildContractPlan({ ...QUOTE_BASE, bid: 0, ask: 2.4, mark: 1.2 });
  assert.equal(plan.quote_invalid_reason, "zero_bid");
  const blocks = planQualityGateBlocks(plan);
  assert.equal(blocks.some((b) => b.code === "plan_quote_invalid"), true);
  const v = evaluateZeroDteGates(input({ plan }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "plan_quote_invalid"), true);
});

test("WS-04 (2): crossed market (bid>ask) → blocked (crossed)", () => {
  // bid>ask made spread_pct NEGATIVE → −x > 15 false → PASSED. Now fails closed.
  const plan = buildContractPlan({ ...QUOTE_BASE, bid: 2.6, ask: 2.4, mark: 2.5 });
  assert.equal(plan.quote_invalid_reason, "crossed");
  assert.equal(planQualityGateBlocks(plan).some((b) => b.code === "plan_quote_invalid"), true);
});

test("WS-04 (3): locked market (bid==ask) → blocked (locked)", () => {
  // bid==ask made spread_pct 0 → 0 > 15 false → PASSED. Now fails closed.
  const plan = buildContractPlan({ ...QUOTE_BASE, bid: 2.4, ask: 2.4, mark: 2.4 });
  assert.equal(plan.quote_invalid_reason, "locked");
  assert.equal(planQualityGateBlocks(plan).some((b) => b.code === "plan_quote_invalid"), true);
});

test("WS-04 (4): stale quote beyond age → blocked (plan_quote_stale)", () => {
  // Quote age is NOT plumbed onto ContractPlan today, so this exercises the predicate
  // helper directly (proving the logic) — the moment a timestamp is threaded through
  // buildContractPlan, the same reason surfaces as a plan_quote_stale block with no
  // further change. A within-bound age stays valid.
  const stale = evaluateQuoteValidity({
    bid: 2.3,
    ask: 2.5,
    mark: 2.4,
    quoteAgeMs: QUOTE_VALIDITY.max_quote_age_ms + 1,
  });
  assert.equal(stale, "stale");
  const fresh = evaluateQuoteValidity({
    bid: 2.3,
    ask: 2.5,
    mark: 2.4,
    quoteAgeMs: QUOTE_VALIDITY.max_quote_age_ms - 1,
  });
  assert.equal(fresh, null);
  // And a plan carrying a stale reason translates to the distinct stale code.
  const plan: ContractPlan = { ...CLEAN_PLAN, quote_invalid_reason: "stale" };
  const blocks = planQualityGateBlocks(plan);
  assert.equal(blocks.some((b) => b.code === "plan_quote_stale"), true);
  assert.equal(blocks.some((b) => b.code === "plan_quote_invalid"), false);
});

test("D3 (WS-04 age now LIVE): a plumbed stale quote-age → plan_quote_stale block; pre-D3 (no age) did NOT block", () => {
  // Pre-D3 the scan passed NO quoteAgeMs (OptionSnapshot dropped last_quote.last_updated), so
  // the `stale` branch was DEAD in prod: a clean book with a minutes-old quote committed as fresh.
  const dormant = buildContractPlan({ ...QUOTE_BASE, bid: 2.3, ask: 2.5, mark: 2.4 });
  assert.equal(dormant.quote_invalid_reason, null, "no age → predicate dormant (pre-D3 behavior)");
  assert.deepEqual(planQualityGateBlocks(dormant), []);

  // D3 plumbs a real age. A book identical in every other way but with an age beyond the bound
  // now fails closed with the DISTINCT plan_quote_stale code (not plan_quote_invalid).
  const stale = buildContractPlan({
    ...QUOTE_BASE,
    bid: 2.3,
    ask: 2.5,
    mark: 2.4,
    quoteAgeMs: QUOTE_VALIDITY.max_quote_age_ms + 5_000,
  });
  assert.equal(stale.quote_invalid_reason, "stale");
  const blocks = planQualityGateBlocks(stale);
  assert.equal(blocks.some((b) => b.code === "plan_quote_stale"), true);
  assert.equal(blocks.some((b) => b.code === "plan_quote_invalid"), false);
  const v = evaluateZeroDteGates(input({ plan: stale }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "plan_quote_stale"), true);
});

test("D3: a fresh quote-age commits (no stale block); a missing age stays dormant (back-compat)", () => {
  // Within the freshness bound → commits, unregressed.
  const fresh = buildContractPlan({
    ...QUOTE_BASE,
    bid: 2.3,
    ask: 2.5,
    mark: 2.4,
    quoteAgeMs: QUOTE_VALIDITY.max_quote_age_ms - 1,
  });
  assert.equal(fresh.quote_invalid_reason, null);
  assert.equal(evaluateZeroDteGates(input({ plan: fresh })).verdict, "COMMIT");

  // Missing age (undefined / null) → the predicate is never applied → NOT blocked on absence.
  const noAge = buildContractPlan({ ...QUOTE_BASE, bid: 2.3, ask: 2.5, mark: 2.4, quoteAgeMs: null });
  assert.equal(noAge.quote_invalid_reason, null);
  assert.deepEqual(planQualityGateBlocks(noAge), []);
});

test("WS-04 (5): a valid quote still commits (unregressed)", () => {
  const plan = buildContractPlan({ ...QUOTE_BASE, bid: 2.3, ask: 2.5, mark: 2.4 });
  assert.equal(plan.quote_invalid_reason, null);
  assert.deepEqual(planQualityGateBlocks(plan), []);
  const v = evaluateZeroDteGates(input({ plan }));
  assert.equal(v.verdict, "COMMIT");
});

test("WS-04 (6): mark outside [bid,ask] → blocked (mark_out_of_band)", () => {
  const plan = buildContractPlan({ ...QUOTE_BASE, bid: 2.3, ask: 2.5, mark: 3.1 });
  assert.equal(plan.quote_invalid_reason, "mark_out_of_band");
  assert.equal(planQualityGateBlocks(plan).some((b) => b.code === "plan_quote_invalid"), true);
});

test("WS-04: absolute-dollar spread over cap → blocked (wide_dollars); a proportional-but-fine book passes", () => {
  // Backstop to the % check: a $6 spread on a $60 mark is 10% (< 15% → legacy PASS) but
  // an absolute $6 exit tax on a 0DTE scalp. The new dollar cap catches it.
  const wide = evaluateQuoteValidity({ bid: 57, ask: 63, mark: 60 });
  assert.equal(wide, "wide_dollars");
  const ok = evaluateQuoteValidity({ bid: 59.6, ask: 60.4, mark: 60 });
  assert.equal(ok, null);
});

test("WS-04: min-size only enforced when the provider reports size (conditional)", () => {
  // Absent size → not enforced (absent size is not proof of illiquidity).
  assert.equal(evaluateQuoteValidity({ bid: 2.3, ask: 2.5, mark: 2.4 }), null);
  // Present but below floor → blocked.
  assert.equal(
    evaluateQuoteValidity({ bid: 2.3, ask: 2.5, mark: 2.4, bidSize: 0.5, askSize: 5 }),
    "thin_size"
  );
});

// ── G-12 · confluence floor (Phase 1) ────────────────────────────────────────────
const EARLY_ET = 10 * 60 + 15; // 10:15 ET — inside the measured-negative early window

test("G-12: no confluence read attached → fails OPEN (commits, never manufactures a block)", () => {
  const v = evaluateZeroDteGates(input({ confluence: null }));
  assert.equal(v.verdict, "COMMIT");
  assert.ok(!v.blocks.some((b) => b.code === "confluence_floor"));
});

test("G-12: 0-confluence (the −12.5% EV bucket) is BLOCKED at the precision floor of 2", () => {
  assert.equal(ZERODTE_CONFLUENCE_MIN, 2, "test assumes the precision default floor");
  const v = evaluateZeroDteGates(input({ confluence: confluence(0) }));
  assert.equal(v.verdict, "BLOCKED");
  const b = v.blocks.find((x) => x.code === "confluence_floor");
  assert.ok(b, "expected a confluence_floor block");
  assert.equal(b!.threshold, 2);
  assert.match(b!.reason, /0 of the needed 2 confluence/);
});

test("G-12: 1-conf BLOCKED / 2-conf commits at mid-session (11:00, floor 2)", () => {
  assert.equal(evaluateZeroDteGates(input({ confluence: confluence(1) })).verdict, "BLOCKED");
  assert.equal(evaluateZeroDteGates(input({ confluence: confluence(2) })).verdict, "COMMIT");
});

test("G-12: early window [10:00,10:45) — precision floor 2; 1-conf blocked, 2-conf commits", () => {
  assert.equal(ZERODTE_CONFLUENCE_MIN_EARLY, 2, "test assumes the precision early floor");
  assert.equal(
    evaluateZeroDteGates(input({ confluence: confluence(1), nowEtMinutes: EARLY_ET })).verdict,
    "BLOCKED"
  );
  const zeroEarly = evaluateZeroDteGates(input({ confluence: confluence(0), nowEtMinutes: EARLY_ET }));
  assert.equal(zeroEarly.verdict, "BLOCKED");
  const b = zeroEarly.blocks.find((x) => x.code === "confluence_floor");
  assert.ok(b);
  assert.equal(b!.threshold, 2);
  assert.equal(
    evaluateZeroDteGates(input({ confluence: confluence(2), nowEtMinutes: EARLY_ET })).verdict,
    "COMMIT"
  );
});

test("confluenceFloorAt: early floor inside [10:00,10:45), base floor outside", () => {
  assert.equal(confluenceFloorAt(EARLY_ET), ZERODTE_CONFLUENCE_MIN_EARLY);
  assert.equal(confluenceFloorAt(10 * 60), ZERODTE_CONFLUENCE_MIN_EARLY); // 10:00 inclusive
  assert.equal(confluenceFloorAt(10 * 60 + 45), ZERODTE_CONFLUENCE_MIN); // 10:45 exclusive
  assert.equal(confluenceFloorAt(11 * 60), ZERODTE_CONFLUENCE_MIN); // 11:00
  assert.equal(confluenceFloorAt(9 * 60 + 40), ZERODTE_CONFLUENCE_MIN); // before the unlock
});

// ── WS-21 · source-recovery commit gate (default-OFF flag) ───────────────────────────

test("WS-21: flag OFF (requireHealthySource absent) — commit behavior byte-for-byte unchanged", () => {
  // The clean input commits. Adding a non-HEALTHY sourceHealth WITHOUT arming the flag must not
  // change the verdict — the field is inert unless requireHealthySource is true.
  assert.equal(evaluateZeroDteGates(input()).verdict, "COMMIT");
  assert.equal(
    evaluateZeroDteGates(input({ sourceHealth: "OFFLINE" })).verdict,
    "COMMIT",
    "source state is inert while the flag is off"
  );
  assert.equal(
    evaluateZeroDteGates(input({ requireHealthySource: false, sourceHealth: "CATCHING_UP" })).verdict,
    "COMMIT"
  );
});

test("WS-21: flag ON — a committing setup is WITHHELD until the source is HEALTHY", () => {
  for (const state of ["OFFLINE", "RECOVERING", "CATCHING_UP", "WARM"] as const) {
    const v = evaluateZeroDteGates(input({ requireHealthySource: true, sourceHealth: state }));
    assert.equal(v.verdict, "BLOCKED", `flag ON must withhold in ${state}`);
    const block = v.blocks.find((b) => b.code === "source_recovering");
    assert.ok(block, `source_recovering block expected in ${state}`);
  }
  // HEALTHY authorizes the same setup.
  const healthy = evaluateZeroDteGates(input({ requireHealthySource: true, sourceHealth: "HEALTHY" }));
  assert.equal(healthy.verdict, "COMMIT");
  assert.ok(!healthy.blocks.some((b) => b.code === "source_recovering"));
});

test("WS-21: flag ON but sourceHealth null — gate does not manufacture a block", () => {
  const v = evaluateZeroDteGates(input({ requireHealthySource: true, sourceHealth: null }));
  assert.equal(v.verdict, "COMMIT");
});

// ════════════════════════════════════════════════════════════════════════════════════
// SECOND-WAVE adversarial coverage (test/zerodte-core-suite) — the paths the first pass
// did NOT reach: env kill-switch="0" firewall PASS, every threshold's exact boundary,
// stacked firewalls, and the correlated-ticker / conflict-score boundaries.
// ════════════════════════════════════════════════════════════════════════════════════

// ── Firewall kill-switches: BLOCK when default-on, PASS when the env switch = "0" ─────
// The four Phase-0 fail-closed constants (G4_/G7_/G11_/G11_HALT_..._ENABLED) are read ONCE
// at module load, so the "= 0 disables it" contract can only be exercised in a fresh module
// registry — a child process with the env var set. The BLOCK (default-on) half is covered by
// the existing single-process tests above; here we pin BOTH halves of the kill-switch together
// so a silent default flip (firewall shipped OFF) is caught.
const HERE = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(HERE, "gates.ts");
const REPO_ROOT = join(HERE, "..", "..", "..");

/** Spawn the gate evaluator in a fresh process with `env` applied at module load, for one
 *  clean directional scenario whose ONLY block is the named firewall. Returns the block codes. */
function runFirewallScenario(scenario: "g4" | "g7" | "g11earn" | "g11halt", env: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "ks-"));
  const runner = join(dir, "runner.mts");
  writeFileSync(
    runner,
    `
import { evaluateZeroDteGates } from ${JSON.stringify(GATES_PATH)};
const nowMs = Date.parse("2026-07-13T15:00:00Z");
const CLEAN_PLAN = { occ:"O:NVDA260713P00100000", flow_avg_fill:2, bid:1.9, ask:2.1, mark:2, entry_max:2, vs_flow_pct:0, entry_status:"IN_RANGE", spread_pct:10, illiquid:false, stop_premium:1, target_premium:4, time_stop_et:"15:30", underlying_target:null, underlying_invalid:null };
const base = { ticker:"NVDA", direction:"short", score:70, nowEtMinutes:660, nowMs, bias:"down", biasAsOfMs: nowMs-60000, governor:{open_plans:[],stops:[]}, plan: CLEAN_PLAN, intradayConflict:false, halted:false, earnings:null, todayYmd:"2026-07-13", macroEvents:[] };
const scenarios = {
  g4: { vixDayOpen:null, vixUnavailable:true },
  g7: { macroUnavailable:true },
  g11earn: { earnings:null, earningsUnavailable:true },
  g11halt: { halted:false, haltFeedStale:true },
};
const v = evaluateZeroDteGates({ ...base, ...scenarios[${JSON.stringify(scenario)}] });
console.log(JSON.stringify(v.blocks.map((b) => b.code)));
`,
    "utf8"
  );
  const res = spawnSync("npx", ["tsx", runner], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `child failed: ${res.stderr}`);
  const line = res.stdout.trim().split("\n").filter(Boolean).pop() ?? "[]";
  return JSON.parse(line) as string[];
}

const FIREWALLS: Array<{
  scenario: "g4" | "g7" | "g11earn" | "g11halt";
  killVar: string;
  code: string;
}> = [
  { scenario: "g4", killVar: "ZERODTE_G4_FAIL_CLOSED", code: "vix_unavailable" },
  { scenario: "g7", killVar: "ZERODTE_G7_FAIL_CLOSED", code: "macro_unavailable" },
  { scenario: "g11earn", killVar: "ZERODTE_G11_FAIL_CLOSED", code: "earnings_unavailable" },
  { scenario: "g11halt", killVar: "ZERODTE_G11_HALT_FAIL_CLOSED", code: "halt_feed_stale" },
];

for (const { scenario, killVar, code } of FIREWALLS) {
  test(`firewall kill-switch ${killVar}: default-ON BLOCKs (${code}) but "0" lets the same fresh commit through`, () => {
    // Default (the var UNSET so the module default holds): the firewall fires.
    const on = runFirewallScenario(scenario, { [killVar]: "" });
    assert.ok(on.includes(code), `default-on must block with ${code}, got ${JSON.stringify(on)}`);
    // Kill switch off ("0"): the SAME clean commit passes — the firewall is the only block, so
    // with it disabled the verdict is a clean COMMIT (empty block list).
    const off = runFirewallScenario(scenario, { [killVar]: "0" });
    assert.ok(!off.includes(code), `"0" must NOT block with ${code}, got ${JSON.stringify(off)}`);
    assert.deepEqual(off, [], `with the firewall off the clean commit has zero blocks, got ${JSON.stringify(off)}`);
  });
}

// ── A working (already-committed) row must NOT be re-blocked by a null refresh-lane context ──
// The gate stack is for FRESH commits; the contract is that a null gate context is a fail-closed
// block for a NEW commit but the caller never runs the stack on an already-committed row. Here we
// pin the fail-closed direction: a null governor (the refresh lane can't read state) blocks a
// fresh commit — and ONLY with gate_context_unavailable, not any directional block that would
// imply the row was re-judged on stale directional inputs.
test("refresh-lane: a null governor context fails a FRESH commit closed with exactly gate_context_unavailable", () => {
  const v = evaluateZeroDteGates(input({ governor: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["gate_context_unavailable"]);
});

// ── G-1 aligned-UP long commits (mirror of the base down/short fixture) ──────────────
test("G-1: a long aligned WITH an up tape commits (positive mirror of the base fixture)", () => {
  const v = evaluateZeroDteGates(input({ bias: "up", direction: "long" }));
  assert.equal(v.verdict, "COMMIT");
  assert.deepEqual(v.blocks, []);
});

// ── G-1 stale-bias EXACT boundary (fail-closed threshold) ────────────────────────────
test("G-1: bias age exactly at MARKET_BIAS_MAX_AGE_MS is fresh; one ms older fails closed", () => {
  const edge = evaluateZeroDteGates(input({ biasAsOfMs: NOW_MS - MARKET_BIAS_MAX_AGE_MS }));
  assert.equal(edge.verdict, "COMMIT");
  const overByOne = evaluateZeroDteGates(input({ biasAsOfMs: NOW_MS - MARKET_BIAS_MAX_AGE_MS - 1 }));
  assert.equal(overByOne.verdict, "BLOCKED");
  assert.equal(overByOne.blocks[0]!.code, "no_market_bias");
});

// ── G-2 opening-window EXACT boundary (one minute before the unlock still blocks) ─────
test("G-2: 9:59 blocks, 10:00 commits — the unlock boundary is inclusive to the minute", () => {
  assert.equal(evaluateZeroDteGates(input({ nowEtMinutes: 9 * 60 + 59 })).verdict, "BLOCKED");
  assert.equal(evaluateZeroDteGates(input({ nowEtMinutes: 10 * 60 })).verdict, "COMMIT");
});

// ── G-3 score-floor EXACT boundary (raw comparison, not the rounded display) ──────────
test("G-3: score 64.999 blocks, exactly 65 commits — the floor comparison is on the raw score", () => {
  assert.equal(evaluateZeroDteGates(input({ score: 64.999 })).verdict, "BLOCKED");
  assert.equal(evaluateZeroDteGates(input({ score: 65 })).verdict, "COMMIT");
});

// ── G-4 VIX tier EXACT boundaries (elevated 17, extreme 20) ──────────────────────────
test("G-4: 16.999 is normal, exactly 17 is elevated, 19.999 is elevated, exactly 20 is extreme", () => {
  // 16.999 → normal regime, no floor bump; a flat-tape 70 commits.
  assert.equal(evaluateZeroDteGates(input({ vixDayOpen: 16.999, score: 70, bias: "flat" })).calibration.g4_vix.tier, "normal");
  // Exactly 17 (>= elevated) → flat-tape 70 still commits (flat = aligned, 65 floor).
  const at17 = evaluateZeroDteGates(input({ vixDayOpen: 17, score: 70, bias: "flat" }));
  assert.equal(at17.calibration.g4_vix.tier, "elevated");
  assert.equal(at17.verdict, "COMMIT");
  // Exactly 17 with null bias (unknown tape) at 70 < 75 → blocked.
  const at17null = evaluateZeroDteGates(input({ vixDayOpen: 17, score: 70, bias: null }));
  assert.equal(at17null.calibration.g4_vix.tier, "elevated");
  assert.ok(at17null.blocks.some((b) => b.code === "vix_elevated"));
  // 19.999 → still elevated (a single name at 90 clears the 75 elevated floor).
  const nvdaHi = evaluateZeroDteGates(input({ ticker: "NVDA", vixDayOpen: 19.999, score: 90, bias: "flat" }));
  assert.equal(nvdaHi.calibration.g4_vix.tier, "elevated");
  assert.equal(nvdaHi.verdict, "COMMIT");
  // Exactly 20 (>= extreme) → the same single name is blocked outright (index/ETF only).
  const nvdaExtreme = evaluateZeroDteGates(input({ ticker: "NVDA", vixDayOpen: 20, score: 90, bias: "flat" }));
  assert.equal(nvdaExtreme.calibration.g4_vix.tier, "extreme");
  assert.ok(nvdaExtreme.blocks.some((b) => b.code === "vix_extreme"));
});

test("G-4: elevated flat-tape score floor is 65 (same as aligned) — 64 blocks, 65 clears", () => {
  const at64 = evaluateZeroDteGates(input({ vixDayOpen: 18, score: 64, bias: "flat" }));
  assert.ok(at64.blocks.some((b) => b.code === "vix_elevated"));
  const at65 = evaluateZeroDteGates(input({ vixDayOpen: 18, score: 65, bias: "flat" }));
  assert.equal(at65.verdict, "COMMIT");
  // Null bias triggers G-1 no_market_bias first (can't reach G-4), so the 75 elevated
  // floor for unknown tape is tested via the calibration path and fail-closed tests.
});

// ── G-4: elevated-VIX tape scoping must match G-1's (index/ETF only) ─────────────────
// Bug found 2026-08-26: the elevated-VIX floor read `input.bias` vs `input.direction`
// unconditionally, so a single name (which G-1 already exempts from tape alignment
// entirely) with a disagreeing SPY bias was silently held to the stricter 75 floor —
// re-imposing exactly the SPY-tape constraint G-1 was written to remove for single names.
test("G-4: a single name with a DISAGREEING SPY bias still gets the standard 65 floor (G-1 exempts it from tape alignment)", () => {
  // NVDA long, SPY tape DOWN (disagreeing) — G-1 never fires for single names, so this
  // must reach G-4 and clear at the standard 65 floor, not the 75 elevated-counter-tape floor.
  const v = evaluateZeroDteGates(
    input({ ticker: "NVDA", direction: "long", bias: "down", score: 70, vixDayOpen: 18 })
  );
  assert.equal(v.calibration.g4_vix.tier, "elevated");
  assert.equal(v.verdict, "COMMIT", "single names must not be judged against the SPY tape at all");
  assert.ok(!v.blocks.some((b) => b.code === "vix_elevated"));

  // The same score/VIX/disagreeing-bias combination on an INDEX ETF must still block —
  // this fix must not loosen the elevated floor for the instrument class it actually protects.
  const vEtf = evaluateZeroDteGates(
    input({ ticker: "QQQ", direction: "long", bias: "down", score: 70, vixDayOpen: 18 })
  );
  assert.equal(vEtf.verdict, "BLOCKED");
  assert.ok(vEtf.blocks.some((b) => b.code === "tape_alignment"), "index ETF counter-tape still blocked by G-1 before G-4 is reached");
});

test("computeGateCalibration: a single name's g4_vix.tier ignores SPY bias the same way the live gate does", () => {
  const v = evaluateZeroDteGates(
    input({ ticker: "NVDA", direction: "long", bias: "down", score: 70, vixDayOpen: 18 })
  );
  assert.equal(v.calibration.g4_vix.would_block, false);
  assert.match(v.calibration.g4_vix.note, /tape-aligned/);
});

// ── G-4 fail-closed couldBlock narrowing: index/ETF flat at EXACTLY the 65 floor ──────
test("G-4 fail-closed: an index/ETF flat-tape at 65+ could NOT have been blocked → unavailable VIX passes it", () => {
  // couldBlock = !isIndexEtf || (!tapeAlignedOrFlat && score < 75). QQQ flat → tapeAlignedOrFlat=true → couldBlock false.
  const v = evaluateZeroDteGates(input({ ticker: "QQQ", score: 65, bias: "flat", vixDayOpen: null, vixUnavailable: true }));
  assert.equal(v.verdict, "COMMIT");
  assert.ok(!v.blocks.some((b) => b.code === "vix_unavailable"));
  // Null bias (unknown tape) at 74 < 75 → a present elevated VIX COULD have blocked it → fails closed.
  const vNull74 = evaluateZeroDteGates(input({ ticker: "QQQ", score: 74, bias: null, vixDayOpen: null, vixUnavailable: true }));
  assert.equal(vNull74.verdict, "BLOCKED");
  assert.ok(vNull74.blocks.some((b) => b.code === "vix_unavailable"));
});

// ── Stacked firewalls: every fail-closed signal at once surfaces every code ───────────
test("stacked firewalls: vix + macro + earnings + halt-feed unavailable all block one fresh commit at once", () => {
  const v = evaluateZeroDteGates(
    input({
      ticker: "NVDA",
      vixDayOpen: null,
      vixUnavailable: true,
      macroUnavailable: true,
      earnings: null,
      earningsUnavailable: true,
      halted: false,
      haltFeedStale: true,
      // clean everything else so ONLY the firewalls fire
    })
  );
  assert.equal(v.verdict, "BLOCKED");
  const codes = v.blocks.map((b) => b.code);
  for (const c of ["vix_unavailable", "macro_unavailable", "earnings_unavailable", "halt_feed_stale"]) {
    assert.ok(codes.includes(c), `expected ${c} in ${JSON.stringify(codes)}`);
  }
});

// ── G-6 correlated-ticker set + conflict-score EXACT boundary ─────────────────────────
test("G-6: an SPX-correlated short (QQQ/NDX) opposing a live Slayer long conflicts; score 64 blocks, 65 clears", () => {
  const slayerLive = { direction: "long" as const };
  for (const ticker of ["QQQ", "NDX"]) {
    const conflict = evaluateZeroDteGates(input({ ticker, direction: "short", score: 64, slayerLive }));
    assert.equal(conflict.verdict, "BLOCKED", `${ticker} at 64 should block`);
    assert.ok(conflict.blocks.some((b) => b.code === "cross_system_conflict"));
    // Exactly 65 overrides the conflict (CONFLICT_SCORE_FLOOR is 65, comparison is `< 65`).
    const cleared = evaluateZeroDteGates(input({ ticker, direction: "short", score: 65, slayerLive }));
    assert.equal(cleared.verdict, "COMMIT", `${ticker} at 65 should override the conflict`);
    assert.equal(cleared.calibration.g6_conflict.conflict, true, "still FLAGGED as a conflict in calibration");
  }
});

// ── gateRejectionFor over a CONDOR verdict: primary code is the condor block ───────────
// ── Condor G-4: VIX regime threshold is EXTREME (≥20), not elevated (≥17) ─────────
test("condor G-4: VIX 18 (elevated) does NOT block a condor — condors sell premium into the range", () => {
  const v = evaluateZeroDteGates({
    ...input({ vixDayOpen: 18, bias: "flat" }),
    play_type: "CONDOR",
    condorPlan: null, // null plan → condor_liquidity will block, but condor_vix_regime should NOT
    plan: null,
  });
  assert.ok(!v.blocks.some((b) => b.code === "condor_vix_regime"), "elevated VIX should not block condors");
});

test("condor G-4: VIX 20 (extreme) DOES block a condor — range integrity threatened", () => {
  const v = evaluateZeroDteGates({
    ...input({ vixDayOpen: 20, bias: "flat" }),
    play_type: "CONDOR",
    condorPlan: null,
    plan: null,
  });
  assert.ok(v.blocks.some((b) => b.code === "condor_vix_regime"), "extreme VIX must block condors");
});

test("condor G-4: unavailable VIX still fails closed for condors", () => {
  const v = evaluateZeroDteGates({
    ...input({ vixDayOpen: null, vixUnavailable: true, bias: "flat" }),
    play_type: "CONDOR",
    condorPlan: null,
    plan: null,
  });
  assert.ok(v.blocks.some((b) => b.code === "condor_vix_regime"), "unavailable VIX fails closed for condors");
});

test("gateRejectionFor: a condor's liquidity block becomes the primary gate_failed on the rejection row", () => {
  const v = evaluateZeroDteGates({
    ...input(),
    play_type: "CONDOR",
    condorPlan: null, // no priced structure → condor_liquidity fails closed
    plan: null,
    bias: "flat",
  });
  assert.equal(v.verdict, "BLOCKED");
  const row = gateRejectionFor(rejectionSource, v);
  assert.equal(row.gate_failed, v.blocks[0]!.code, "primary = first-evaluated failing gate");
  assert.equal(row.gate_failed, "condor_liquidity");
});

// ── Condor + FOMC macro gate tests (CTO audit coverage) ─────────────────────────

test("condor G-7: a condor is BLOCKED by G-7 when ANY high-impact macro event exists (whole session, not just window)", () => {
  // A condor is short vol — a CPI/FOMC/NFP breakout is its worst case — so the
  // macro block covers the WHOLE session for condors, not just the ±window around the
  // release that directional plays use. A FOMC event at 14:00 ET blocks a condor at
  // 11:00 ET (well before the release window).
  const v = evaluateZeroDteGates({
    ...input({
      bias: "flat",
      nowEtMinutes: 11 * 60, // 11:00 ET — well before any FOMC window
      macroEvents: [{ event: "FOMC Rate Decision", time: "14:00", date: "2026-07-13", country: "US" }],
    }),
    play_type: "CONDOR",
    condorPlan: null,
    plan: null,
  });
  assert.equal(v.verdict, "BLOCKED");
  assert.ok(
    v.blocks.some((b) => b.code === "condor_macro_block"),
    "condor must be blocked by condor_macro_block when a high-impact macro event exists"
  );
  assert.match(
    v.blocks.find((b) => b.code === "condor_macro_block")!.reason,
    /whole session/,
    "reason should mention whole-session scope"
  );
});

test("condor range-break: a condor whose spot has breached a short strike is BLOCKED", () => {
  // condorRangeBreaking returns true when spot is at or past a short strike — the
  // range the condor defends is failing, so the sale is held.
  const condorPlan = {
    play_type: "CONDOR" as const,
    expiry: "2026-07-13",
    dte: 0,
    spot: 500,         // spot AT the short call → breached
    short_put: 495,
    long_put: 490,
    short_call: 500,
    long_call: 505,
    put_width_pct: 1,
    call_width_pct: 1,
    wing_pts: 5,
    legs: [],
    net_credit: 1.5,
    gross_wing_risk: 500,
    max_loss: 498.5,
    credit_to_risk: 0.003,
    breach_lower: 495,
    breach_upper: 500,
    max_leg_spread_pct: 5,
    illiquid: false,
    est_win_rate: null,
    net_credit_mid: null,
  };
  const v = evaluateZeroDteGates({
    ...input({ bias: "flat" }),
    play_type: "CONDOR",
    condorPlan,
    plan: null,
  });
  assert.equal(v.verdict, "BLOCKED");
  assert.ok(
    v.blocks.some((b) => b.code === "condor_range_break"),
    "condor must be blocked when spot has breached a short strike"
  );
});

test("FOMC afternoon window: directional play lifts after the ±15m window, condor stays blocked all session", () => {
  // FOMC at 14:00 ET → directional window is [13:45, 14:15]. At 14:30 ET (well past
  // the window), a directional play should NOT be blocked by G-7, but a condor should
  // STILL be blocked because condors block the whole session on any high-impact event.
  const fomcEvent = { event: "FOMC Rate Decision", time: "14:00", date: "2026-07-13", country: "US" };

  // Directional play at 14:30 ET — FOMC window has passed
  const directional = evaluateZeroDteGates(
    input({
      nowEtMinutes: 14 * 60 + 30,  // 14:30 ET — past the 14:15 window end
      macroEvents: [fomcEvent],
    })
  );
  assert.ok(
    !directional.blocks.some((b) => b.code === "macro_hard_block"),
    "directional play at 14:30 should NOT be blocked — FOMC ±15m window (13:45-14:15) has passed"
  );

  // Condor play at the same time — STILL blocked (whole session)
  const condor = evaluateZeroDteGates({
    ...input({
      bias: "flat",
      nowEtMinutes: 14 * 60 + 30,  // 14:30 ET — same time
      macroEvents: [fomcEvent],
    }),
    play_type: "CONDOR",
    condorPlan: null,
    plan: null,
  });
  assert.ok(
    condor.blocks.some((b) => b.code === "condor_macro_block"),
    "condor at 14:30 must STILL be blocked — condors block the whole session on FOMC day"
  );
});

// ── G-12 null-confluence telemetry counter ──────────────────────────────────────

test("G-12 telemetry: null confluence increments the fail-open counter", () => {
  const before = getNullConfluencePassCount();
  // A directional play with null confluence → G-12 fails open and increments the counter.
  evaluateZeroDteGates(input({ confluence: null }));
  assert.equal(getNullConfluencePassCount(), before + 1, "counter should increment on null confluence");
  // A second call increments again.
  evaluateZeroDteGates(input({ confluence: null }));
  assert.equal(getNullConfluencePassCount(), before + 2);
  // A present confluence does NOT increment.
  evaluateZeroDteGates(input({ confluence: confluence(1) }));
  assert.equal(getNullConfluencePassCount(), before + 2, "present confluence must not increment");
  // A condor with null confluence does NOT increment (G-12 skips condors entirely).
  evaluateZeroDteGates({
    ...input({ confluence: null, bias: "flat" }),
    play_type: "CONDOR",
    condorPlan: null,
    plan: null,
  });
  assert.equal(getNullConfluencePassCount(), before + 2, "condor skips G-12 — no increment");
});

// ── Regime Plane + G-13 (Wave A/B) ───────────────────────────────────────────────

test("regime_blind blocks fresh commit when regime plane is blind", () => {
  const v = evaluateZeroDteGates(
    input({
      regimeBlockFreshCommits: true,
      regimeBlockReason: "Regime blind (day-open VIX unreadable) — no fresh commits until inputs recover.",
    }),
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.ok(v.blocks.some((b) => b.code === "regime_blind"));
});

test("G-13 flow_accumulation_conflict blocks when aligned === false", () => {
  const v = evaluateZeroDteGates(input({ flowAccumulationAligned: false }));
  assert.equal(v.verdict, "BLOCKED");
  assert.ok(v.blocks.some((b) => b.code === "flow_accumulation_conflict"));
});

test("G-13 reason names the ACTUAL blocked ticker/direction, not a hardcoded example", () => {
  // Regression: the reason string used to hardcode a literal "(MU-long/bearish-acc class)"
  // example with no interpolation at all — every blocked setup, regardless of its real
  // ticker or direction, rendered that identical sentence (confirmed live: SPXW/SPY/QQQ/NVDA
  // all showed "(MU-long/bearish-acc class)" verbatim on 2026-08-04).
  const nvda = evaluateZeroDteGates(input({ ticker: "NVDA", direction: "long", flowAccumulationAligned: false }));
  const block1 = nvda.blocks.find((b) => b.code === "flow_accumulation_conflict");
  assert.ok(block1?.reason.includes("NVDA-long"), `expected NVDA-long in reason, got: ${block1?.reason}`);
  assert.ok(!block1?.reason.includes("MU-long"), "must not carry the stale hardcoded example ticker");

  const tsla = evaluateZeroDteGates(input({ ticker: "TSLA", direction: "short", flowAccumulationAligned: false }));
  const block2 = tsla.blocks.find((b) => b.code === "flow_accumulation_conflict");
  assert.ok(block2?.reason.includes("TSLA-short"), `expected TSLA-short in reason, got: ${block2?.reason}`);
});

test("G-13 does not block when flow accumulation aligned or absent", () => {
  assert.equal(evaluateZeroDteGates(input({ flowAccumulationAligned: true })).verdict, "COMMIT");
  assert.equal(evaluateZeroDteGates(input({ flowAccumulationAligned: null })).verdict, "COMMIT");
});

test("stack fix: VIX unavailable without regime_blind — index ETF flat at 70 commits (G-4 narrowing)", () => {
  const v = evaluateZeroDteGates(
    input({
      ticker: "QQQ",
      score: 70,
      bias: "flat",
      vixDayOpen: null,
      vixUnavailable: true,
      regimeBlockFreshCommits: false,
    }),
  );
  assert.equal(v.verdict, "COMMIT");
  assert.ok(!v.blocks.some((b) => b.code === "regime_blind"));
  assert.ok(!v.blocks.some((b) => b.code === "vix_unavailable"));
});

test("stack fix: single name with null SPY tape does not fail G-12 when VWAP-side confirms", () => {
  const v = evaluateZeroDteGates(
    input({
      ticker: "NVDA",
      bias: null,
      confluence: {
        score: 1,
        confirmations: 1,
        timing_ok: true,
        early_window: false,
        vwap_ok: true,
        market_ok: false,
        tier: "weak",
        label: "VWAP only",
      },
    }),
  );
  assert.equal(v.verdict, "COMMIT");
  assert.ok(!v.blocks.some((b) => b.code === "confluence_floor"));
  assert.ok(!v.blocks.some((b) => b.code === "no_market_bias"));
});
