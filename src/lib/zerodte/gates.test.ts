import { test } from "node:test";
import assert from "node:assert/strict";

// gates.ts is a pure leaf (type-only imports from ./board, ./intraday) — no
// mock.module scaffolding needed, unlike scan.test.ts's provider graph.
import {
  evaluateZeroDteGates,
  gateRejectionFor,
  MARKET_BIAS_MAX_AGE_MS,
  planQualityGateBlocks,
  confluenceFloorAt,
  ZERODTE_CONFLUENCE_MIN,
  ZERODTE_CONFLUENCE_MIN_EARLY,
  type ZeroDteGateInput,
} from "./gates";
import type { ContractPlan } from "./plan";
import type { ZeroDteConfluence } from "./confluence";

/** Minimal confluence read carrying just the `confirmations` count G-12 gates on. */
function conf(confirmations: number, over: Partial<ZeroDteConfluence> = {}): ZeroDteConfluence {
  return {
    score: confirmations,
    confirmations,
    timing_ok: true,
    early_window: false,
    vwap_ok: confirmations >= 1,
    market_ok: confirmations >= 2,
    tier: confirmations >= 2 ? "double" : "weak",
    label: "test",
    ...over,
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
 *  test flips exactly the dimension it exercises. */
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

// ── G-3 · score floor ──────────────────────────────────────────────────────────────

test("G-3: score 64 blocks, 65 commits (the 55-64 band is below breakeven)", () => {
  const blocked = evaluateZeroDteGates(input({ score: 64 }));
  assert.equal(blocked.verdict, "BLOCKED");
  assert.equal(blocked.blocks[0]!.code, "score_floor");
  assert.equal(blocked.blocks[0]!.threshold, 65);
  assert.match(blocked.blocks[0]!.reason, /18\.8% WR/);

  assert.equal(evaluateZeroDteGates(input({ score: 65 })).verdict, "COMMIT");
});

test("G-3: judged on the POST-edge-layer score — 7/13's INTC short (61) blocks even though aligned and mid-day", () => {
  const v = evaluateZeroDteGates(input({ ticker: "INTC", score: 61, nowEtMinutes: 12 * 60 + 51 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["score_floor"]);
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
  const governor = { open_plans: [{ ticker: "TSLA", direction: "short" as const }], stops: [] };
  assert.equal(
    evaluateZeroDteGates(
      input({ governor, committedThisCycle: [{ ticker: "AMZN", direction: "short" }] })
    ).verdict,
    "COMMIT"
  );
  const v = evaluateZeroDteGates(
    input({
      governor,
      committedThisCycle: [
        { ticker: "AMZN", direction: "short" },
        { ticker: "GOOGL", direction: "short" },
      ],
    })
  );
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

test("G-4: elevated VIX without readable tape alignment still needs score >= 75", () => {
  const weak = evaluateZeroDteGates(input({ vixDayOpen: 18, score: 70, bias: "flat" }));
  assert.equal(weak.verdict, "BLOCKED");
  assert.equal(weak.blocks.some((b) => b.code === "vix_elevated"), true);
  assert.match(weak.blocks.find((b) => b.code === "vix_elevated")!.reason, /25% WR/);
  assert.equal(weak.calibration.g4_vix.tier, "elevated");
  assert.equal(weak.calibration.g4_vix.would_block, true);
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

test("G-4: unknown VIX does not block — fail-open on missing data (tier engine handles the penalty)", () => {
  const v = evaluateZeroDteGates(input({ vixDayOpen: null }));
  assert.equal(v.calibration.g4_vix.tier, "unknown");
  assert.equal(v.calibration.g4_vix.would_block, false);
  assert.equal(v.verdict, "COMMIT");
});

// ── G-6 · cross-system conflict (HARD GATE — promoted from calibration 2026-07-16) ──

test("G-6: opposing Night Hawk's take with score < 80 BLOCKS (was calibration-only)", () => {
  const v = evaluateZeroDteGates(
    input({
      ticker: "META",
      direction: "short",
      score: 67,
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

test("G-6: opposing the live Slayer play on an SPX-correlated ticker BLOCKS at score < 80", () => {
  const slayerLive = { direction: "long" as const };
  const spy = evaluateZeroDteGates(input({ ticker: "SPY", direction: "short", slayerLive }));
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

test("G-6: score >= 80 overrides the conflict — CONFLICT still flagged but commits", () => {
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

test("G-10: intraday_conflict hard-blocks", () => {
  const v = evaluateZeroDteGates(input({ intradayConflict: true }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "intraday_conflict"), true);
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

// ── G-12 · confluence floor (Change 1 & 2, 2026-07-24) ───────────────────────────────

test("G-12 default floor blocks a ZERO-confluence commit even at a very high score (the loud-print-alone case)", () => {
  // score 95 clears G-3 easily; but 0 confirmations is the −12.5% EV bucket. Before G-12 the
  // additive score carried it onto the board; now it's blocked.
  const v = evaluateZeroDteGates(input({ score: 95, confluence: conf(0) }));
  assert.equal(v.verdict, "BLOCKED");
  const block = v.blocks.find((b) => b.code === "confluence_floor");
  assert.ok(block, "confluence_floor must fire");
  assert.equal(block!.threshold, ZERODTE_CONFLUENCE_MIN);
  assert.match(block!.reason, /0-confirmation bucket ran −12\.5% EV|loud premium print/);
});

test("G-12 default floor: a single confirmation commits mid-session (11:00, standard floor = 1)", () => {
  const v = evaluateZeroDteGates(input({ confluence: conf(1) }));
  assert.equal(v.verdict, "COMMIT");
  assert.deepEqual(v.blocks, []);
});

test("G-12 fails OPEN when no confluence read is attached (never manufactures a block from an unmeasured factor)", () => {
  // The default input() carries no confluence — the fixture-replay / legacy path. Commits as before.
  const v = evaluateZeroDteGates(input());
  assert.equal(v.verdict, "COMMIT");
  assert.equal(v.blocks.some((b) => b.code === "confluence_floor"), false);
});

test("G-12 early window (10:15) raises the floor to 2: a 1-conf setup that would commit at 11:00 is held", () => {
  const early = 10 * 60 + 15;
  const oneConf = evaluateZeroDteGates(input({ nowEtMinutes: early, confluence: conf(1) }));
  assert.equal(oneConf.verdict, "BLOCKED");
  const block = oneConf.blocks.find((b) => b.code === "confluence_floor");
  assert.ok(block, "early-window 1-conf must block");
  assert.equal(block!.threshold, ZERODTE_CONFLUENCE_MIN_EARLY);
  assert.match(block!.reason, /early window/);

  // The full VWAP+market double clears the early window.
  const twoConf = evaluateZeroDteGates(input({ nowEtMinutes: early, confluence: conf(2) }));
  assert.equal(twoConf.verdict, "COMMIT");

  // And the SAME 1-conf setup commits once past 10:45 (standard floor).
  const late = evaluateZeroDteGates(input({ nowEtMinutes: 11 * 60, confluence: conf(1) }));
  assert.equal(late.verdict, "COMMIT");
});

test("confluenceFloorAt: standard floor outside the early window, higher floor inside [10:00, 10:45)", () => {
  assert.equal(confluenceFloorAt(9 * 60 + 40), ZERODTE_CONFLUENCE_MIN); // pre-unlock
  assert.equal(confluenceFloorAt(10 * 60), ZERODTE_CONFLUENCE_MIN_EARLY); // 10:00 inclusive
  assert.equal(confluenceFloorAt(10 * 60 + 44), ZERODTE_CONFLUENCE_MIN_EARLY); // 10:44 inside
  assert.equal(confluenceFloorAt(10 * 60 + 45), ZERODTE_CONFLUENCE_MIN); // 10:45 exclusive end
  assert.equal(confluenceFloorAt(11 * 60), ZERODTE_CONFLUENCE_MIN); // past it
  assert.ok(ZERODTE_CONFLUENCE_MIN_EARLY > ZERODTE_CONFLUENCE_MIN, "early floor must be strictly higher");
});

test("G-12 default floor is the conservative research-backed 1 (block only the losing 0-conf bucket)", () => {
  assert.equal(ZERODTE_CONFLUENCE_MIN, 1);
  assert.equal(ZERODTE_CONFLUENCE_MIN_EARLY, 2);
});

// ── Change 3 · staleness tightened to 5 min (config-gated) ──────────────────────────

test("MARKET_BIAS_MAX_AGE_MS default tightened to 5 minutes (0DTE reaction-speed guard)", () => {
  assert.equal(MARKET_BIAS_MAX_AGE_MS, 5 * 60 * 1000);
});

test("G-1 staleness: a 6-minute-old SPY bar now blocks (would have passed under the old 15-min window)", () => {
  const sixMinOld = NOW_MS - 6 * 60 * 1000;
  const v = evaluateZeroDteGates(input({ biasAsOfMs: sixMinOld }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");

  // 4 minutes old is still fresh under the tightened window.
  assert.equal(
    evaluateZeroDteGates(input({ biasAsOfMs: NOW_MS - 4 * 60 * 1000 })).verdict,
    "COMMIT"
  );
});
