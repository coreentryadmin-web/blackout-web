import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveZeroDteSetups, enrichSetup, type EnrichedZeroDteSetup } from "./board";
import {
  buildPinSetup,
  evaluatePinRegime,
  mergePinOrigins,
  pickAtmPinContract,
  pinScore,
  pinSourceEnabled,
  type PinChainRow,
  type PinRegimeInput,
} from "./pin-source";
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

/** A textbook long-gamma pin: spot 596 pinned between a dominant put wall 590 and call wall 610,
 *  in the LOWER half of the band (near the put wall, offset 0.4) → fade UP → long. Walls ~9% dominant. */
function pinNearPutWall(): PinRegimeInput {
  return {
    spot: 596,
    callWall: 610,
    putWall: 590,
    callWallPct: 9,
    putWallPct: 9,
    gammaPosture: "long",
  };
}

// ── Flags: ON by default, OFF only when explicitly set to "0" ──────────────────────
test("pinSourceEnabled is ON by default and disabled with '0'", () => {
  delete process.env.ZERODTE_WHOLE_MARKET;
  delete process.env.ZERODTE_SRC_PIN;
  assert.equal(pinSourceEnabled(), true, "both unset → ON by default");
  process.env.ZERODTE_WHOLE_MARKET = "0";
  assert.equal(pinSourceEnabled(), false, "master=0 → disabled");
  delete process.env.ZERODTE_WHOLE_MARKET;
  process.env.ZERODTE_SRC_PIN = "0";
  assert.equal(pinSourceEnabled(), false, "per-source=0 → disabled");
  delete process.env.ZERODTE_SRC_PIN;
});

// ── Regime filter: only long-gamma, bracketed, contained, off-center ranges qualify ──
test("evaluatePinRegime emits ONLY in a genuine long-gamma dealer-defended range; else null", () => {
  // Textbook pin near the put wall → fade UP (long).
  const up = evaluatePinRegime(pinNearPutWall());
  assert.ok(up, "a clean long-gamma bracket is a pin");
  assert.equal(up!.fadeDirection, "long", "near the put wall (lower half) → fade UP → long");
  assert.equal(up!.pin, 600, "pin = midpoint of the defended band");

  // Mirror: spot near the call wall (upper half) → fade DOWN (short).
  const down = evaluatePinRegime({ ...pinNearPutWall(), spot: 604 });
  assert.ok(down);
  assert.equal(down!.fadeDirection, "short", "near the call wall (upper half) → fade DOWN → short");

  // NOT long-gamma → not a pin (short-gamma is trend-amplifying, the opposite of pinning).
  assert.equal(evaluatePinRegime({ ...pinNearPutWall(), gammaPosture: "short" }), null);
  assert.equal(evaluatePinRegime({ ...pinNearPutWall(), gammaPosture: null }), null);

  // Spot outside the bracket → not a pin.
  assert.equal(evaluatePinRegime({ ...pinNearPutWall(), spot: 611 }), null, "above the call wall");
  assert.equal(evaluatePinRegime({ ...pinNearPutWall(), spot: 589 }), null, "below the put wall");

  // One-sided / thin walls → not a defended bracket.
  assert.equal(evaluatePinRegime({ ...pinNearPutWall(), callWall: null }), null);
  assert.equal(evaluatePinRegime({ ...pinNearPutWall(), putWallPct: 2 }), null, "weak put wall (2% < 4% floor)");

  // Band too WIDE (walls 550/650 around 598 ≈ 16.7%) → not a contained pin.
  assert.equal(
    evaluatePinRegime({ ...pinNearPutWall(), callWall: 650, putWall: 550 }),
    null,
    "a 16% band is a range, not a dealer-contained pin"
  );

  // Dead-center spot (offset ≈ 0) → no directional fade edge (that is the Phase-4 condor case).
  assert.equal(evaluatePinRegime({ ...pinNearPutWall(), spot: 600 }), null, "centered → no directional fade");

  // Hugging a wall (offset > 0.9) → breakout risk, not a pin.
  assert.equal(evaluatePinRegime({ ...pinNearPutWall(), spot: 609.9 }), null, "at the call wall → breakout risk");
});

// ── Score mapping: solid pins clear 65; bracket-floor pins do not ────────────────────
test("pinScore: solid regime-qualified pins clear 65; bracket-floor pins do not", () => {
  // Bracket-floor walls (4%) + band at the loose edge (6%) → containment 0 → well below 65.
  assert.ok(pinScore({ bracketDomPct: 4, bandWidthPct: 6, offset: 0.6 }) < 65);
  // Moderate walls (6%) + a 4% band → still below 65.
  assert.ok(pinScore({ bracketDomPct: 6, bandWidthPct: 4, offset: 0.6 }) < 65);
  // Recalibrated 2026-07-28: a genuine mid-tier pin clears the shared floor.
  assert.ok(pinScore({ bracketDomPct: 7.5, bandWidthPct: 2.5, offset: 0.6 }) >= 65);
  assert.ok(pinScore({ bracketDomPct: 9, bandWidthPct: 2, offset: 0.6 }) >= 65);
  // Textbook (dominant + tight + good fade room) saturates near the top.
  assert.ok(pinScore({ bracketDomPct: 12, bandWidthPct: 1.5, offset: 0.6 }) >= 90);
  // Fade room ALONE (weak, wide bracket) can never lift a non-pin over the floor.
  assert.ok(pinScore({ bracketDomPct: 4, bandWidthPct: 6, offset: 1 }) < 40);
  // Bounds hold.
  const s = pinScore({ bracketDomPct: 100, bandWidthPct: 0, offset: 10 });
  assert.ok(s >= 0 && s <= 100);
});

// ── Seed→setup bridge: scored ["PIN"] setup, honest nulls, real otm_pct, correct fade side ──
test("buildPinSetup builds a scored ['PIN'] setup with honest flow nulls, real otm_pct, and the fade direction", () => {
  const regime = evaluatePinRegime(pinNearPutWall())!; // long fade → call
  const setup = buildPinSetup({
    ticker: "spy",
    spot: 596,
    regime,
    contract: { strike: 597, expiry: TODAY, dte: 0, side: "call" },
  });
  assert.deepEqual(setup.discovery_origin, ["PIN"]);
  assert.equal(setup.direction, "long", "long fade toward the pin");
  assert.equal(setup.ticker, "SPY");
  assert.equal(setup.top_strike, 597);
  assert.equal(setup.underlying_price, 596);
  // Call fade: (597 − 596)/596 ≈ +0.17% OTM.
  assert.ok(setup.otm_pct != null && setup.otm_pct > 0 && setup.otm_pct < 0.5);
  // Honest flow nulls/neutral — never fabricated.
  assert.equal(setup.aggression, null);
  assert.equal(setup.gross_premium, 0);
  assert.equal(setup.prints, 0);
  assert.equal(setup.top_strike_avg_fill, null);
  assert.equal(setup.flow_quality, null);
  assert.equal(setup.side_dominance, 0.5);
  assert.equal(setup.new_money, false);
  assert.equal(setup.spike, false);
  assert.ok(setup.score >= 0 && setup.score <= 100);
  // HORIZON (PR-1): a 0DTE picked contract stamps ZERO_DTE + the same-day grading policy.
  assert.equal(setup.contract_horizon, "ZERO_DTE");
  assert.equal(setup.actual_dte_at_commit, 0);
  assert.equal(setup.grading_policy, "same_day_1530_close");

  // A 1DTE picked contract stamps ONE_DTE (still same-day discipline scope).
  const oneDte = buildPinSetup({
    ticker: "spy",
    spot: 596,
    regime,
    contract: { strike: 597, expiry: "2026-07-25", dte: 1, side: "call" },
  });
  assert.equal(oneDte.contract_horizon, "ONE_DTE");
  assert.equal(oneDte.actual_dte_at_commit, 1);
  assert.equal(oneDte.grading_policy, "same_day_1530_close");

  // Short fade builds a PUT-side setup with OTM measured the other way (spot − strike).
  const shortRegime = evaluatePinRegime({ ...pinNearPutWall(), spot: 604 })!;
  const shortSetup = buildPinSetup({
    ticker: "SPY",
    spot: 604,
    regime: shortRegime,
    contract: { strike: 603, expiry: TODAY, dte: 0, side: "put" },
  });
  assert.equal(shortSetup.direction, "short");
  // Put fade: (604 − 603)/604 ≈ +0.17% OTM (positive = OTM on the put side too).
  assert.ok(shortSetup.otm_pct != null && shortSetup.otm_pct > 0 && shortSetup.otm_pct < 0.5);
});

// ── ATM picker: call for a long fade, put for a short fade; 0DTE preferred, dte 1-4 fallback ──
test("pickAtmPinContract picks the fade side's ATM contract (0DTE preferred, dte 1-4 allowed, dte≥5 EXCLUDED — widened 2026-08-06)", () => {
  const rows: PinChainRow[] = [
    { expiry: TODAY, strike: 597, call_bid: 1.2, call_ask: 1.3, call_oi: 500, put_bid: 0.8, put_ask: 0.9, put_oi: 400 },
    { expiry: TODAY, strike: 598, call_bid: 1.0, call_ask: 1.1, call_oi: 800, put_bid: 1.0, put_ask: 1.1, put_oi: 700 },
    { expiry: TODAY, strike: 599, call_bid: 0.7, call_ask: 0.8, call_oi: 300, put_bid: 1.3, put_ask: 1.4, put_oi: 900 },
    { expiry: "2026-07-31", strike: 598, call_bid: 2.0, call_ask: 2.2, call_oi: 900, put_bid: 2.0, put_ask: 2.2, put_oi: 900 },
  ];
  const call = pickAtmPinContract(rows, 598.2, TODAY, "call");
  assert.ok(call);
  assert.equal(call!.side, "call");
  assert.equal(call!.expiry, TODAY, "0DTE preferred");
  assert.equal(call!.strike, 598, "ATM = closest to spot");
  const put = pickAtmPinContract(rows, 598.2, TODAY, "put");
  assert.ok(put);
  assert.equal(put!.side, "put");
  assert.equal(put!.strike, 598);

  // 1DTE (dte 1) is admitted when no 0DTE is listed (ONE_DTE horizon).
  const oneDteOnly: PinChainRow[] = [
    { expiry: "2026-07-25", strike: 598, call_bid: 1.5, call_ask: 1.6, call_oi: 700, put_bid: 1.5, put_ask: 1.6, put_oi: 700 },
  ];
  const one = pickAtmPinContract(oneDteOnly, 598.2, TODAY, "put");
  assert.ok(one);
  assert.equal(one!.dte, 1);

  // Widened 2026-08-06: dte-2 and dte-4 are now ALSO admitted (a Friday-only-weekly name hit on a
  // Monday-Wednesday).
  const twoDteOnly: PinChainRow[] = [
    { expiry: "2026-07-26", strike: 598, call_bid: 1.5, call_ask: 1.6, call_oi: 700, put_bid: 1.5, put_ask: 1.6, put_oi: 700 },
  ];
  const two = pickAtmPinContract(twoDteOnly, 598.2, TODAY, "put");
  assert.ok(two, "dte-2 is now admitted");
  assert.equal(two!.dte, 2);

  const fourDteOnly: PinChainRow[] = [
    { expiry: "2026-07-28", strike: 598, call_bid: 1.5, call_ask: 1.6, call_oi: 700, put_bid: 1.5, put_ask: 1.6, put_oi: 700 },
  ];
  const four = pickAtmPinContract(fourDteOnly, 598.2, TODAY, "put");
  assert.ok(four, "dte-4 is the new outer edge — still admitted");
  assert.equal(four!.dte, 4);

  // HORIZON INTEGRITY (PR-1, widened): a dte≥5 weekly is EXCLUDED (null) — the picker is clamped to
  // dte ≤ ZERODTE_MAX_DTE (4), so a farther-out weekly-only pin is dropped from the 0DTE board
  // rather than graded with the same-day 15:30 time-stop (structurally wrong for a multi-day weekly).
  const weeklyOnly: PinChainRow[] = [
    { expiry: "2026-07-31", strike: 598, call_bid: 2, call_ask: 2.2, call_oi: 900, put_bid: 2, put_ask: 2.2, put_oi: 900 },
  ];
  assert.equal(pickAtmPinContract(weeklyOnly, 598.2, TODAY, "put"), null, "weekly (dte 7) is excluded");

  // Beyond the window → null.
  const farOnly: PinChainRow[] = [
    { expiry: "2026-08-15", strike: 598, call_bid: 2, call_ask: 2.2, call_oi: 900, put_bid: 2, put_ask: 2.2, put_oi: 900 },
  ];
  assert.equal(pickAtmPinContract(farOnly, 598.2, TODAY, "call"), null);

  // A dead PUT side (no quote, no OI) → null even though the CALL side is liquid.
  const deadPut: PinChainRow[] = [
    { expiry: TODAY, strike: 598, call_bid: 1, call_ask: 1.1, call_oi: 800, put_bid: null, put_ask: null, put_oi: 0 },
  ];
  assert.equal(pickAtmPinContract(deadPut, 598.2, TODAY, "put"), null);
  assert.ok(pickAtmPinContract(deadPut, 598.2, TODAY, "call"), "the call side is still tradeable");
});

// ── Merge: union origins by ticker, preserve as a SET, append unique ─────────────────
test("mergePinOrigins unions a shared ticker to ['FLOW','PIN'] and appends unique pin tickers", () => {
  const flow: EnrichedZeroDteSetup[] = deriveZeroDteSetups(
    [cleanFlowRow("NVDA")],
    { todayYmd: TODAY, nowMs: Date.parse(`${TODAY}T14:05:00Z`) }
  ).map((s) => enrichSetup(s, null));
  assert.equal(flow.length, 1);

  const regime = evaluatePinRegime(pinNearPutWall())!;
  const pins = [
    // Shared ticker (NVDA) — its origin unions onto the flow setup, keeping the flow evidence.
    buildPinSetup({ ticker: "NVDA", spot: 596, regime, contract: { strike: 597, expiry: TODAY, dte: 0, side: "call" } }),
    // Pin-only ticker (SPY) — appended with its origin.
    buildPinSetup({ ticker: "SPY", spot: 596, regime, contract: { strike: 597, expiry: TODAY, dte: 0, side: "call" } }),
  ];

  const merged = mergePinOrigins(flow, pins);
  const nvda = merged.find((s) => s.ticker === "NVDA")!;
  const spy = merged.find((s) => s.ticker === "SPY")!;
  assert.deepEqual(nvda.discovery_origin, ["FLOW", "PIN"], "a ticker found by BOTH carries both origins, never collapsed");
  assert.equal(nvda.gross_premium > 0, true, "the flow evidence is kept on the shared ticker (not the bare pin)");
  assert.deepEqual(spy.discovery_origin, ["PIN"], "a pin-only ticker is appended with its origin");
  assert.equal(merged.length, 2, "no duplicate row for the shared ticker");
});

test("mergePinOrigins: opposing PIN does not get corroboration boost (v2)", () => {
  const flow: EnrichedZeroDteSetup[] = deriveZeroDteSetups(
    [cleanFlowRow("NVDA")],
    { todayYmd: TODAY, nowMs: Date.parse(`${TODAY}T14:05:00Z`) }
  ).map((s) => enrichSetup(s, null));
  assert.equal(flow.length, 1);
  const before = flow[0]!.score;
  // Pin near put wall → long fade. Flow from cleanFlowRow is a call (long). If same direction,
  // we'd get a boost — force opposing by flipping the pin direction after build.
  const regime = evaluatePinRegime(pinNearPutWall())!;
  const pin = buildPinSetup({
    ticker: "NVDA",
    spot: 596,
    regime,
    contract: { strike: 597, expiry: TODAY, dte: 0, side: "call" },
  });
  // Ensure opposing: if pin happened to agree with flow, flip pin to short for this unit test.
  if (pin.direction === flow[0]!.direction) {
    pin.direction = flow[0]!.direction === "long" ? "short" : "long";
  }
  // Keep pin score ≤ flow so seating/score keeps FLOW (we are testing the no-boost path, not ownership).
  pin.score = Math.min(pin.score, before);
  mergePinOrigins(flow, [pin]);
  assert.equal(flow[0]!.score, before, "opposing co-discovery must not receive +8");
  assert.ok(flow[0]!.origin_direction_conflict, "opposing pin must stamp a conflict");
});

// ── Gate boundary + G-1: a pin fade passes the SHARED hard gates in a flat tape; G-1 culls it
//    when the fade fights a trending broad tape ─────────────────────────────────────────────
test("a pin fade bypasses the FLOW evidence gates, clears the shared stack in a flat tape, and G-1 blocks the counter-tape case", () => {
  // A genuinely dominant, tightly-contained pin near the put wall (walls 11%, band ~2.35%, offset
  // ~0.57) → scores above the 65 floor. long fade → call.
  const regime = evaluatePinRegime({
    spot: 595,
    callWall: 606,
    putWall: 592,
    callWallPct: 11,
    putWallPct: 11,
    gammaPosture: "long",
  })!;
  assert.equal(regime.fadeDirection, "long");
  const setup = buildPinSetup({
    ticker: "SPY",
    spot: 595,
    regime,
    contract: { strike: 596, expiry: TODAY, dte: 0, side: "call" },
  });
  // A strong pin scores above the floor (dominant + tight bracket). Sanity-guard the gate test.
  assert.ok(setup.score >= 65, `strong pin should clear G-3 (score=${setup.score})`);

  const liquidPlan: ContractPlan = {
    occ: "O:SPY260724C00599000",
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
    direction: setup.direction, // long fade
    score: setup.score,
    nowEtMinutes: 11 * 60,
    nowMs: Date.parse(`${TODAY}T15:00:00Z`),
    bias: "flat", // a flat/ranging broad tape — the pin regime's normal companion (G-1 passes)
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
  const flat = evaluateZeroDteGates(baseGateInput);
  assert.equal(
    flat.verdict,
    "COMMIT",
    `a strong pin fade in a flat tape should clear the shared gates (blocks: ${flat.blocks.map((b) => b.code).join(",")})`
  );
  assert.ok(!flat.blocks.some((b) => b.code === "tape_alignment"), "G-1 does not fire in a flat tape");

  // Counter-tape: the SAME long fade against a DOWN broad tape → G-1 correctly blocks (a pin fighting
  // a trend isn't a pin). We deliberately do NOT bypass G-1 — the strict regime filter + G-1 are
  // defense-in-depth.
  const counter = evaluateZeroDteGates({ ...baseGateInput, bias: "down" });
  assert.equal(counter.verdict, "BLOCKED");
  assert.ok(counter.blocks.some((b) => b.code === "tape_alignment"), "G-1 blocks a fade that fights the broad tape");

  // And the shared G-3 score floor STILL applies to a pin — a weak pin score is blocked.
  const weak = evaluateZeroDteGates({ ...baseGateInput, score: 40 });
  assert.equal(weak.verdict, "BLOCKED");
  assert.ok(weak.blocks.some((b) => b.code === "score_floor"), "G-3 score floor must gate a pin candidate");
});

// ── NH-R4: session_gap_days is evidence-only, never gates/scores ──────────────────
test("buildPinSetup: session_gap_days is null without todayYmd, and reflects the real weekend/holiday gap when supplied", () => {
  const regime = evaluatePinRegime(pinNearPutWall())!;
  // No todayYmd supplied (existing callers/tests) → honest null, never fabricated.
  const noToday = buildPinSetup({
    ticker: "SPY",
    spot: 596,
    regime,
    contract: { strike: 597, expiry: TODAY, dte: 0, side: "call" },
  });
  assert.equal(noToday.session_gap_days, null);

  // TODAY (2026-07-24) is a Friday. `contract.dte` is whatever the caller stamps (buildPinSetup
  // trusts it, exactly as it does for horizon/grading_policy above) — here we exercise the
  // session_gap_days WIRING with a contract whose real expiry (Monday 2026-07-27) spans a plain
  // weekend, regardless of what dte label is attached to it.
  const weekendHold = buildPinSetup({
    ticker: "SPY",
    spot: 596,
    regime,
    contract: { strike: 597, expiry: "2026-07-27", dte: 1, side: "call" },
    todayYmd: TODAY,
  });
  assert.equal(weekendHold.session_gap_days, 2, "Sat+Sun skipped between Fri and Mon");
  // Score/gate-relevant fields are untouched by the gap — evidence only, no penalty in this PR.
  assert.equal(weekendHold.score, noToday.score);
});
