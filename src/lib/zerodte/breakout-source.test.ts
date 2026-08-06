import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveZeroDteSetups, enrichSetup, type EnrichedZeroDteSetup, type ZeroDteSetup } from "./board";
import {
  breakoutScore,
  breakoutSourceEnabled,
  buildBreakoutSetup,
  liquidityQualityScore,
  mergeDiscoveryOrigins,
  pickAtmZeroDteContract,
  pickBreakoutContractWithFallback,
  breakoutAllow1DteFallback,
  type BreakoutChainRow,
} from "./breakout-source";
import { evaluateZeroDteGates, type ZeroDteGateInput } from "./gates";
import type { ContractPlan } from "./plan";

const TODAY = "2026-07-24";

/** A clean single at-the-ask 0DTE call print that survives deriveZeroDteSetups' four evidence gates. */
function cleanFlowRow(ticker: string, premium = 2_000_000) {
  return {
    ticker,
    premium,
    option_type: "call",
    strike: 145,
    expiry: TODAY,
    dte: 0,
    alert_rule: "sweep",
    ask_pct: 75,
    underlying_price: 140,
    fill_price: 4.2,
    open_interest: 100,
    alerted_at: `${TODAY}T14:00:00.000Z`,
  };
}

// ── Flow origin default ─────────────────────────────────────────────────────────────
test("a flow-discovered setup defaults discovery_origin to [\"FLOW\"]", () => {
  const setups = deriveZeroDteSetups([cleanFlowRow("NVDA")], { todayYmd: TODAY, nowMs: Date.parse(`${TODAY}T14:05:00Z`) });
  assert.equal(setups.length, 1);
  assert.deepEqual(setups[0]!.discovery_origin, ["FLOW"]);
  // Survives enrichment unchanged (spread through enrichSetup).
  assert.deepEqual(enrichSetup(setups[0]!, null).discovery_origin, ["FLOW"]);
});

// ── Breakout seed→setup bridge ──────────────────────────────────────────────────────
test("buildBreakoutSetup builds a scored setup carrying discovery_origin [\"BREAKOUT\"] with honest flow nulls", () => {
  const setup = buildBreakoutSetup({
    mover: { ticker: "asts", gain: 0.15, close_strength: 0.9, volume: 20_000_000, dollar: 900_000_000 },
    spot: 42.5,
    contract: { strike: 44, expiry: TODAY, dte: 0 },
    dollarNorm: 1,
  });
  assert.deepEqual(setup.discovery_origin, ["BREAKOUT"]);
  assert.equal(setup.direction, "long");
  assert.equal(setup.ticker, "ASTS");
  assert.equal(setup.top_strike, 44);
  assert.equal(setup.expiry, TODAY);
  assert.equal(setup.underlying_price, 42.5);
  // Real moneyness of the picked call strike: (44 − 42.5)/42.5 ≈ 3.53% OTM.
  assert.ok(setup.otm_pct != null && setup.otm_pct > 3 && setup.otm_pct < 4);
  // Honest flow nulls/neutral — never fabricated.
  assert.equal(setup.aggression, null);
  assert.equal(setup.gross_premium, 0);
  assert.equal(setup.prints, 0);
  assert.equal(setup.top_strike_avg_fill, null);
  assert.equal(setup.flow_quality, null);
  assert.equal(setup.side_dominance, 0.5);
  assert.equal(setup.new_money, false);
  assert.equal(setup.spike, false);
  // Score in-range and, for a strong breakout, above the floor.
  assert.ok(setup.score >= 0 && setup.score <= 100);
  // HORIZON (PR-1): a 0DTE picked contract stamps ZERO_DTE + the same-day grading policy.
  assert.equal(setup.contract_horizon, "ZERO_DTE");
  assert.equal(setup.actual_dte_at_commit, 0);
  assert.equal(setup.grading_policy, "same_day_1530_close");
});

// ── HORIZON integrity: build-site tag reflects the REAL selected-contract dte ─────────
test("buildBreakoutSetup stamps contract_horizon/actual_dte_at_commit/grading_policy from the contract dte", () => {
  const base = { ticker: "asts", gain: 0.15, close_strength: 0.9, volume: 20_000_000, dollar: 900_000_000 };
  const zero = buildBreakoutSetup({ mover: base, spot: 42.5, contract: { strike: 44, expiry: TODAY, dte: 0 }, dollarNorm: 1 });
  assert.equal(zero.contract_horizon, "ZERO_DTE");
  assert.equal(zero.actual_dte_at_commit, 0);
  assert.equal(zero.grading_policy, "same_day_1530_close");

  const one = buildBreakoutSetup({ mover: base, spot: 42.5, contract: { strike: 44, expiry: "2026-07-25", dte: 1 }, dollarNorm: 1 });
  assert.equal(one.contract_horizon, "ONE_DTE");
  assert.equal(one.actual_dte_at_commit, 1);
  assert.equal(one.grading_policy, "same_day_1530_close");
});

// ── Score mapping: real continuations clear 65; weak screen-floor pops do not ────────
test("breakoutScore: liquid 8–10% strong-close clears 65; weak 5% mid-range does not", () => {
  // Screen-floor breakout (5% gain, closed exactly mid-range) with max liquidity → far below 65.
  assert.ok(breakoutScore({ gain: 0.05, close_strength: 0.5 }, 1) < 65);
  // Recalibrated 2026-07-28: a liquid 8% strong-close continuation MUST clear the shared floor
  // (prior map needed ~15%+ and starved the whole-market rail to ~0 commits/day).
  assert.ok(breakoutScore({ gain: 0.08, close_strength: 0.9 }, 1) >= 65);
  assert.ok(breakoutScore({ gain: 0.1, close_strength: 0.8 }, 1) >= 65);
  // Bounds hold at the extremes.
  assert.equal(breakoutScore({ gain: 0.5, close_strength: 1 }, 1), 100);
  // No gain AND no liquidity → BASE only when dollar=0 and core=0 → SCORE_BASE.
  assert.equal(breakoutScore({ gain: 0, close_strength: 1 }, 0), 15);
  // Liquidity ALONE (weak move / mid-range close) can never lift a setup over the floor.
  assert.ok(breakoutScore({ gain: 0.05, close_strength: 0.5 }, 1) < 40);
});

// ── Gate boundary: flow evidence gates SKIPPED for breakout; shared hard gates STILL apply ──
test("flow evidence gates reject a bare (no-flow) ticker, but a breakout setup bypasses them and is judged by the SHARED hard-gate stack", () => {
  // deriveZeroDteSetups' FLOW evidence gates would kill a zero-premium ticker outright — proof the
  // flow gates are hostile to a bare breakout and must NOT run on breakout-origin candidates.
  const rejections: import("./board").ZeroDteGateRejection[] = [];
  const flowFromBare = deriveZeroDteSetups(
    [{ ...cleanFlowRow("ASTS"), premium: 0 }],
    { todayYmd: TODAY, rejections }
  );
  assert.equal(flowFromBare.length, 0, "a no-flow ticker produces zero FLOW setups");

  // The breakout path builds the setup directly (never through deriveZeroDteSetups), so those flow
  // evidence gates structurally never see it. It is instead judged by the shared hard-gate stack.
  const setup = buildBreakoutSetup({
    mover: { ticker: "ASTS", gain: 0.16, close_strength: 0.95, volume: 30_000_000, dollar: 1_000_000_000 },
    spot: 42.5,
    contract: { strike: 43, expiry: TODAY, dte: 0 },
    dollarNorm: 1,
  });

  const liquidPlan: ContractPlan = {
    occ: "O:ASTS260724C00043000",
    flow_avg_fill: null,
    bid: 1.0,
    ask: 1.06,
    mark: 1.03,
    entry_max: 1.03,
    vs_flow_pct: null,
    entry_status: "IN_RANGE",
    spread_pct: 5.8,
    illiquid: false,
    stop_premium: 0.52,
    target_premium: 2.06,
    time_stop_et: "15:30",
    underlying_target: null,
    underlying_invalid: null,
  };
  const baseGateInput: ZeroDteGateInput = {
    ticker: setup.ticker,
    direction: setup.direction,
    score: setup.score,
    nowEtMinutes: 11 * 60, // after the 10:00 unlock
    nowMs: Date.parse(`${TODAY}T15:00:00Z`),
    bias: "up", // aligned with a long
    biasAsOfMs: Date.parse(`${TODAY}T15:00:00Z`),
    governor: { open_plans: [], stops: [] },
    committedThisCycle: [],
    plan: liquidPlan,
    intradayConflict: false,
    halted: false,
    earnings: null,
    todayYmd: TODAY,
    confluence: {
      score: 80,
      confirmations: 2,
      timing_ok: true,
      early_window: false,
      vwap_ok: true,
      market_ok: true,
      tier: "double",
      label: "VWAP + market",
    },
  };
  const verdict = evaluateZeroDteGates(baseGateInput);
  assert.equal(verdict.verdict, "COMMIT", `strong breakout should clear the shared gates (blocks: ${verdict.blocks.map((b) => b.code).join(",")})`);

  // And the shared G-3 score floor STILL applies to a breakout — a weak breakout score is blocked.
  const weak = evaluateZeroDteGates({ ...baseGateInput, score: 40 });
  assert.equal(weak.verdict, "BLOCKED");
  assert.ok(weak.blocks.some((b) => b.code === "score_floor"), "G-3 score floor must gate a breakout candidate");
});

// ── Merge: union origins by ticker, preserve as a SET, append unique ─────────────────
test("mergeDiscoveryOrigins unions a shared ticker to [\"FLOW\",\"BREAKOUT\"] and appends unique breakout tickers", () => {
  const flow: EnrichedZeroDteSetup[] = deriveZeroDteSetups(
    [cleanFlowRow("NVDA")],
    { todayYmd: TODAY, nowMs: Date.parse(`${TODAY}T14:05:00Z`) }
  ).map((s) => enrichSetup(s, null));
  assert.equal(flow.length, 1);

  const breakouts = [
    buildBreakoutSetup({ mover: { ticker: "NVDA", gain: 0.16, close_strength: 0.95, volume: 1e7, dollar: 1e9 }, spot: 140, contract: { strike: 145, expiry: TODAY, dte: 0 }, dollarNorm: 1 }),
    buildBreakoutSetup({ mover: { ticker: "ASTS", gain: 0.15, close_strength: 0.9, volume: 2e7, dollar: 9e8 }, spot: 42.5, contract: { strike: 44, expiry: TODAY, dte: 0 }, dollarNorm: 0.9 }),
  ];

  const merged = mergeDiscoveryOrigins(flow, breakouts);
  const nvda = merged.find((s) => s.ticker === "NVDA")!;
  const asts = merged.find((s) => s.ticker === "ASTS")!;
  assert.deepEqual(nvda.discovery_origin, ["FLOW", "BREAKOUT"], "a ticker found by BOTH carries both origins, never collapsed");
  assert.equal(nvda.gross_premium > 0, true, "the flow evidence is kept on the shared ticker (not the bare breakout)");
  assert.deepEqual(asts.discovery_origin, ["BREAKOUT"], "a breakout-only ticker is appended with its origin");
  assert.equal(merged.length, 2, "no duplicate row for the shared ticker");
});

test("mergeDiscoveryOrigins stamps an opposing-direction co-discovery (Q1) without flipping when scores tie", () => {
  // Kept setup is SHORT (e.g. a flow put-buyer); breakout argues LONG on the same ticker at equal score.
  // v2: seating-order wins ties → kept (FLOW) direction preserved.
  const kept = buildBreakoutSetup({ mover: { ticker: "NVDA", gain: 0.16, close_strength: 0.95, volume: 1e7, dollar: 1e9 }, spot: 140, contract: { strike: 145, expiry: TODAY, dte: 0 }, dollarNorm: 1 });
  kept.direction = "short";
  kept.discovery_origin = ["FLOW"];
  const breakoutLong = buildBreakoutSetup({ mover: { ticker: "NVDA", gain: 0.16, close_strength: 0.95, volume: 1e7, dollar: 1e9 }, spot: 140, contract: { strike: 145, expiry: TODAY, dte: 0 }, dollarNorm: 1 });
  // buildBreakoutSetup is momentum → long.
  assert.equal(breakoutLong.direction, "long");
  assert.equal(kept.score, breakoutLong.score, "fixture scores must tie so seating-order decides");

  const merged = mergeDiscoveryOrigins([kept], [breakoutLong]);
  const nvda = merged.find((s) => s.ticker === "NVDA")!;
  assert.equal(nvda.direction, "short", "tie keeps seated (FLOW) direction — never fabricates agreement");
  assert.deepEqual(nvda.discovery_origin, ["FLOW", "BREAKOUT"], "origins still union");
  assert.deepEqual(nvda.origin_direction_conflict, {
    kept_direction: "short",
    masked_direction: "long",
    masked_origin: ["BREAKOUT"],
  });
  // Opposing co-discovery must NOT get the corroboration boost.
  assert.equal(nvda.score, kept.score, "no +8 boost when rails fight");
});

test("mergeDiscoveryOrigins: higher-score opposing breakout wins the slot (v2 evidence-weighted)", () => {
  const kept = buildBreakoutSetup({ mover: { ticker: "NVDA", gain: 0.05, close_strength: 0.55, volume: 1e7, dollar: 1e8 }, spot: 140, contract: { strike: 145, expiry: TODAY, dte: 0 }, dollarNorm: 0.1 });
  kept.direction = "short";
  kept.discovery_origin = ["FLOW"];
  const weakFlowScore = kept.score;
  const breakoutLong = buildBreakoutSetup({ mover: { ticker: "NVDA", gain: 0.22, close_strength: 0.98, volume: 2e7, dollar: 1e9 }, spot: 140, contract: { strike: 145, expiry: TODAY, dte: 0 }, dollarNorm: 1 });
  assert.equal(breakoutLong.direction, "long");
  assert.ok(breakoutLong.score > weakFlowScore, `breakout (${breakoutLong.score}) must beat flow (${weakFlowScore})`);

  const merged = mergeDiscoveryOrigins([kept], [breakoutLong]);
  const nvda = merged.find((s) => s.ticker === "NVDA")!;
  assert.equal(nvda.direction, "long", "stronger breakout owns the direction under v2");
  assert.deepEqual(nvda.discovery_origin, ["FLOW", "BREAKOUT"]);
  assert.deepEqual(nvda.origin_direction_conflict, {
    kept_direction: "long",
    masked_direction: "short",
    masked_origin: ["FLOW"],
  });
});

test("mergeDiscoveryOrigins: same-direction co-discovery records NO conflict and boosts score", () => {
  const kept = buildBreakoutSetup({ mover: { ticker: "NVDA", gain: 0.16, close_strength: 0.95, volume: 1e7, dollar: 1e9 }, spot: 140, contract: { strike: 145, expiry: TODAY, dte: 0 }, dollarNorm: 1 });
  kept.discovery_origin = ["FLOW"]; // both long (momentum)
  const before = kept.score;
  const breakoutLong = buildBreakoutSetup({ mover: { ticker: "NVDA", gain: 0.16, close_strength: 0.95, volume: 1e7, dollar: 1e9 }, spot: 140, contract: { strike: 145, expiry: TODAY, dte: 0 }, dollarNorm: 1 });
  const merged = mergeDiscoveryOrigins([kept], [breakoutLong]);
  assert.equal(merged[0]!.origin_direction_conflict, undefined);
  assert.equal(merged[0]!.score, Math.min(100, before + 8), "same-direction corroboration gets +8");
});

// ── ATM 0DTE picker: 0DTE preferred, 1DTE allowed, weekly (dte≥2) EXCLUDED ───────────
// HORIZON INTEGRITY (PR-1): the picker is clamped to dte ≤ 1. A 0DTE is preferred, a 1DTE is the
// only fallback, and ANY dte≥2 weekly returns null (dropped from the 0DTE board — not graded with
// the same-day 15:30 time-stop that would be structurally wrong for a multi-day weekly).
test("pickAtmZeroDteContract prefers 0DTE, allows 1DTE, EXCLUDES the weekly (dte≥2) fallback", () => {
  const rows0dteAndWeekly: BreakoutChainRow[] = [
    { expiry: TODAY, strike: 99, call_bid: 1.2, call_ask: 1.3, call_oi: 500 },
    { expiry: TODAY, strike: 100, call_bid: 1.0, call_ask: 1.1, call_oi: 800 },
    { expiry: TODAY, strike: 105, call_bid: 0.2, call_ask: 0.3, call_oi: 100 },
    { expiry: "2026-07-31", strike: 100, call_bid: 2.0, call_ask: 2.2, call_oi: 900 },
  ];
  const pick = pickAtmZeroDteContract(rows0dteAndWeekly, 100.4, TODAY);
  assert.ok(pick);
  assert.equal(pick!.expiry, TODAY, "0DTE expiry is preferred");
  assert.equal(pick!.dte, 0);
  assert.equal(pick!.strike, 100, "ATM = strike closest to the 100.4 spot");

  // No 0DTE listed but a 1DTE (dte 1) exists → the 1DTE (ONE_DTE) is the only allowed fallback.
  const oneDteOnly: BreakoutChainRow[] = [
    { expiry: "2026-07-25", strike: 100, call_bid: 1.5, call_ask: 1.6, call_oi: 700 },
  ];
  const one = pickAtmZeroDteContract(oneDteOnly, 100.4, TODAY);
  assert.ok(one);
  assert.equal(one!.expiry, "2026-07-25");
  assert.equal(one!.dte, 1);

  // No 0DTE/1DTE listed, only a 7-DTE weekly → EXCLUDED (null): a dte≥2 weekly is dropped from the
  // 0DTE board entirely (horizon integrity), not committed and not graded same-day.
  const weeklyOnly: BreakoutChainRow[] = [
    { expiry: "2026-07-31", strike: 100, call_bid: 2.0, call_ask: 2.2, call_oi: 900 },
  ];
  assert.equal(pickAtmZeroDteContract(weeklyOnly, 100.4, TODAY), null, "weekly (dte 7) is excluded");

  // A dte-2 weekly is likewise excluded (the clamp is dte ≤ 1, so 2 is already out).
  const twoDteOnly: BreakoutChainRow[] = [
    { expiry: "2026-07-26", strike: 100, call_bid: 2.0, call_ask: 2.2, call_oi: 900 },
  ];
  assert.equal(pickAtmZeroDteContract(twoDteOnly, 100.4, TODAY), null, "dte-2 weekly is excluded");

  // Only an expiry beyond the window → no contract (→ shared plan gate drops the candidate).
  const farOnly: BreakoutChainRow[] = [
    { expiry: "2026-08-15", strike: 100, call_bid: 2.0, call_ask: 2.2, call_oi: 900 },
  ];
  assert.equal(pickAtmZeroDteContract(farOnly, 100.4, TODAY), null);

  // An illiquid-only chain (no quote, no OI) → null (never seed a plan off a dead strike).
  const dead: BreakoutChainRow[] = [
    { expiry: TODAY, strike: 100, call_bid: null, call_ask: null, call_oi: 0 },
  ];
  assert.equal(pickAtmZeroDteContract(dead, 100.4, TODAY), null);
});

// ── NH-R5: liquidity QUALITY now ranks near-ATM candidates, not just admits them ─────
test("liquidityQualityScore: tighter spread and deeper OI both raise the score, each capped at 1.0", () => {
  const tight = { expiry: TODAY, strike: 100, call_bid: 1.0, call_ask: 1.02, call_oi: 1000 } as BreakoutChainRow;
  const wide = { expiry: TODAY, strike: 100, call_bid: 1.0, call_ask: 2.0, call_oi: 1000 } as BreakoutChainRow;
  const thin = { expiry: TODAY, strike: 100, call_bid: 1.0, call_ask: 1.02, call_oi: 10 } as BreakoutChainRow;
  const noQuote = { expiry: TODAY, strike: 100, call_bid: null, call_ask: null, call_oi: 10 } as BreakoutChainRow;

  const tightScore = liquidityQualityScore(tight, "call");
  const wideScore = liquidityQualityScore(wide, "call");
  const thinScore = liquidityQualityScore(thin, "call");
  const noQuoteScore = liquidityQualityScore(noQuote, "call");

  assert.ok(tightScore > wideScore, `${tightScore} vs ${wideScore}`); // tighter spread wins
  assert.ok(tightScore > thinScore, `${tightScore} vs ${thinScore}`); // deeper OI wins
  // Same OI (10) as `thin`, but no live quote at all — losing the spread-quality component
  // must score strictly lower than having that same OI PLUS a live (even thin-depth) quote.
  assert.ok(noQuoteScore < thinScore, `${noQuoteScore} vs ${thinScore}`);
  assert.ok(tightScore <= 2, `score exceeds the documented 0-2 range: ${tightScore}`);
});

test("pickAtmZeroDteContract: among near-ATM candidates, materially better liquidity wins a close tie", () => {
  // Both strikes are within a dollar of spot (100.4); strike 100 is nominally closer (dist 0.4 vs
  // 100.3's dist 0.1) but strike 100 has a razor-thin quote (huge spread) and 1 lot of OI, while
  // strike 100.3 has a tight two-sided market and real depth. The quality tie-break should now
  // prefer the genuinely tradeable strike over the marginally-closer, effectively-illiquid one.
  const rows: BreakoutChainRow[] = [
    { expiry: TODAY, strike: 100, call_bid: 0.05, call_ask: 0.5, call_oi: 1 },
    { expiry: TODAY, strike: 100.3, call_bid: 1.0, call_ask: 1.02, call_oi: 800 },
  ];
  const pick = pickAtmZeroDteContract(rows, 100.4, TODAY);
  assert.ok(pick);
  assert.equal(pick!.strike, 100.3, "the materially more liquid near-tie strike wins");
});

test("pickAtmZeroDteContract: ATM still dominates — liquidity quality never overrides a materially closer strike", () => {
  // Strike 100 is comfortably closer to spot (dist 0.4) than strike 105 (dist 4.6), even though
  // 105 has a pristine quote and 100 is merely admissible (thin OI, wider spread). The small
  // per-quality-point dollar credit must never flip a multi-dollar distance gap.
  const rows: BreakoutChainRow[] = [
    { expiry: TODAY, strike: 100, call_bid: 0.9, call_ask: 1.1, call_oi: 5 },
    { expiry: TODAY, strike: 105, call_bid: 1.0, call_ask: 1.01, call_oi: 900 },
  ];
  const pick = pickAtmZeroDteContract(rows, 100.4, TODAY);
  assert.ok(pick);
  assert.equal(pick!.strike, 100, "ATM proximity still wins over a distant, higher-quality strike");
});

test("pickBreakoutContractWithFallback: 0DTE first, 1DTE when env allows, weekly excluded", () => {
  delete process.env.ZERODTE_BREAKOUT_ALLOW_1DTE;
  const rows0: BreakoutChainRow[] = [
    { expiry: TODAY, strike: 100, call_bid: 1.0, call_ask: 1.1, call_oi: 800 },
  ];
  const zero = pickBreakoutContractWithFallback(rows0, 100.4, TODAY);
  assert.ok(zero);
  assert.equal(zero!.used_1dte_fallback, false);

  const oneDteOnly: BreakoutChainRow[] = [
    { expiry: "2026-07-25", strike: 100, call_bid: 1.5, call_ask: 1.6, call_oi: 700 },
  ];
  const one = pickBreakoutContractWithFallback(oneDteOnly, 100.4, TODAY);
  assert.ok(one);
  assert.equal(one!.dte, 1);
  assert.equal(one!.used_1dte_fallback, true);

  process.env.ZERODTE_BREAKOUT_ALLOW_1DTE = "0";
  assert.equal(breakoutAllow1DteFallback(), false);
  assert.equal(pickBreakoutContractWithFallback(oneDteOnly, 100.4, TODAY), null);
  delete process.env.ZERODTE_BREAKOUT_ALLOW_1DTE;
});

// ── Flags: ON by default, OFF only when explicitly set to "0" ──────────────────────
test("breakoutSourceEnabled is ON by default and disabled with '0'", () => {
  delete process.env.ZERODTE_WHOLE_MARKET;
  delete process.env.ZERODTE_SRC_BREAKOUT;
  assert.equal(breakoutSourceEnabled(), true, "both unset → ON by default");
  process.env.ZERODTE_WHOLE_MARKET = "0";
  assert.equal(breakoutSourceEnabled(), false, "master=0 → disabled");
  delete process.env.ZERODTE_WHOLE_MARKET;
  process.env.ZERODTE_SRC_BREAKOUT = "0";
  assert.equal(breakoutSourceEnabled(), false, "per-source=0 → disabled");
  delete process.env.ZERODTE_SRC_BREAKOUT;
});

// ── NH-R4: session_gap_days is evidence-only, never gates/scores ──────────────────
test("buildBreakoutSetup: session_gap_days is null without todayYmd, and reflects the real weekend/holiday gap when supplied", () => {
  const mover = { ticker: "asts", gain: 0.15, close_strength: 0.9, volume: 20_000_000, dollar: 900_000_000 };
  // No todayYmd supplied (existing callers/tests) → honest null, never fabricated.
  const noToday = buildBreakoutSetup({ mover, spot: 42.5, contract: { strike: 44, expiry: TODAY, dte: 0 }, dollarNorm: 1 });
  assert.equal(noToday.session_gap_days, null);

  // TODAY (2026-07-24) is a Friday. `contract.dte` is whatever the caller stamps (buildBreakoutSetup
  // trusts it, exactly as it does for horizon/grading_policy above) — here we exercise the
  // session_gap_days WIRING with a contract whose real expiry (Monday 2026-07-27) spans a plain
  // weekend, regardless of what dte label is attached to it.
  const weekendHold = buildBreakoutSetup({
    mover,
    spot: 42.5,
    contract: { strike: 44, expiry: "2026-07-27", dte: 1 },
    dollarNorm: 1,
    todayYmd: TODAY,
  });
  assert.equal(weekendHold.session_gap_days, 2, "Sat+Sun skipped between Fri and Mon");
  // Score/gate-relevant fields are untouched by the gap — evidence only, no penalty in this PR.
  assert.equal(weekendHold.score, noToday.score);
});
