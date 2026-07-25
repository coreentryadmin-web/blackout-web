import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCondorPlan,
  buildCondorSetup,
  condorEligibleTicker,
  condorFlagEnabled,
  condorLiquidityGateBlocks,
  condorRangeBreaking,
  condorSellRegime,
  gradeCondorFromBars,
  CONDOR_MIN_CREDIT_TO_RISK,
  type CondorPlan,
} from "./condor";
import { selectIronCondor, SURFACED_WIN_RATE_CAP } from "./iron-condor";
import { deriveZeroDteSetups } from "./board";
import { buildPinSetup, type PinRegime } from "./pin-source";
import { evaluateZeroDteGates, type ZeroDteGateInput } from "./gates";
import type { PlanBar } from "./plan";

const TODAY = "2026-07-24"; // EDT (-04:00)

// ── Fixtures ────────────────────────────────────────────────────────────────────────
/** Legs for spot 600, target-80 (0.8% width, inc 5): short 595/605, wings 590/610, wing 5pts. */
function legs600() {
  const l = selectIronCondor({ spot: 600, targetWinRate: 80 });
  assert.ok(l, "selectIronCondor produced legs");
  return l!;
}

/** A cleanly-priced, tradeable condor plan: shorts@bid 2.0 each, wings@ask 1.0 each →
 *  net credit (2+2−1−1)·100 = $200, gross wing risk 5·100 = $500, max loss $300. */
function cleanCondorPlan(overrides: Partial<Parameters<typeof buildCondorPlan>[0]["quotes"]> = {}): CondorPlan {
  return buildCondorPlan({
    spot: 600,
    expiry: TODAY,
    dte: 0,
    legs: legs600(),
    quotes: {
      shortPut: { bid: 2.0, ask: 2.2 },
      longPut: { bid: 0.9, ask: 1.0 },
      shortCall: { bid: 2.0, ask: 2.2 },
      longCall: { bid: 0.9, ask: 1.0 },
      ...overrides,
    },
  });
}

/** A deep, tight, centered long-gamma pin — the SELL regime. */
function sellPin(): PinRegime {
  return { fadeDirection: "long", pin: 600, bandWidthPct: 2, offset: 0.3, bracketDomPct: 9 };
}

const flaggedAtMs = Date.parse(`${TODAY}T14:00:00-04:00`);
function barAt(etTime: string, h: number, l: number, c: number): PlanBar {
  return { t: Date.parse(`${TODAY}T${etTime}-04:00`), h, l, c };
}

// ══════════════════════════════════════════════════════════════════════════════════════
// 1. play_type defaults DIRECTIONAL everywhere (flag-off = nothing is a condor)
// ══════════════════════════════════════════════════════════════════════════════════════
test("play_type defaults DIRECTIONAL on a flow-derived setup", () => {
  const setups = deriveZeroDteSetups(
    [
      {
        ticker: "NVDA",
        premium: 3_000_000,
        option_type: "call",
        strike: 145,
        expiry: TODAY,
        dte: 0,
        alert_rule: "sweep",
        ask_pct: 80,
        underlying_price: 140,
        fill_price: 4.2,
        open_interest: 50,
        alerted_at: `${TODAY}T14:00:00.000Z`,
      },
    ],
    { todayYmd: TODAY }
  );
  assert.equal(setups.length, 1);
  assert.equal(setups[0]!.play_type, "DIRECTIONAL");
});

test("play_type defaults DIRECTIONAL on a PIN fade setup", () => {
  const setup = buildPinSetup({
    ticker: "SPY",
    spot: 596,
    regime: { fadeDirection: "long", pin: 600, bandWidthPct: 3, offset: 0.4, bracketDomPct: 9 },
    contract: { strike: 596, expiry: TODAY, dte: 0, side: "call" },
  });
  assert.equal(setup.play_type, "DIRECTIONAL");
  assert.equal(setup.condor_plan ?? null, null, "a directional pin carries no priced condor");
});

test("condor flag is OFF by default", () => {
  delete process.env.ZERODTE_CONDOR;
  assert.equal(condorFlagEnabled(), false);
  process.env.ZERODTE_CONDOR = "1";
  assert.equal(condorFlagEnabled(), true);
  delete process.env.ZERODTE_CONDOR;
});

// ══════════════════════════════════════════════════════════════════════════════════════
// 2. Routing — a PIN candidate is a condor ONLY under the sell regime
// ══════════════════════════════════════════════════════════════════════════════════════
test("condorSellRegime: deep + tight + centered pin → sell", () => {
  const r = condorSellRegime(sellPin());
  assert.equal(r.sell, true);
});

test("condorSellRegime: wide band → NOT a condor (directional fade)", () => {
  const r = condorSellRegime({ ...sellPin(), bandWidthPct: 5 });
  assert.equal(r.sell, false);
  assert.match(r.reason, /band width/);
});

test("condorSellRegime: thin walls → NOT a condor", () => {
  const r = condorSellRegime({ ...sellPin(), bracketDomPct: 5 });
  assert.equal(r.sell, false);
  assert.match(r.reason, /dominance/);
});

test("condorSellRegime: spot hugging a wall → NOT a condor (directional fade)", () => {
  const r = condorSellRegime({ ...sellPin(), offset: 0.8 });
  assert.equal(r.sell, false);
  assert.match(r.reason, /offset/);
});

test("buildCondorSetup stamps CONDOR + PIN origin + attaches the priced plan", () => {
  const s = buildCondorSetup({ ticker: "SPY", spot: 600, regime: sellPin(), plan: cleanCondorPlan(), score: 80 });
  assert.equal(s.play_type, "CONDOR");
  assert.deepEqual(s.discovery_origin, ["PIN"]);
  assert.equal(s.condor_plan?.net_credit, 200);
  assert.equal(s.score, 80);
});

// ══════════════════════════════════════════════════════════════════════════════════════
// 3. Condor plan geometry (shorts / wings / credit / max loss)
// ══════════════════════════════════════════════════════════════════════════════════════
test("buildCondorPlan: geometry + conservative credit (shorts@bid − wings@ask)", () => {
  const p = cleanCondorPlan();
  assert.equal(p.short_put, 595);
  assert.equal(p.long_put, 590);
  assert.equal(p.short_call, 605);
  assert.equal(p.long_call, 610);
  assert.equal(p.wing_pts, 5);
  assert.equal(p.gross_wing_risk, 500); // wing_pts·100
  assert.equal(p.net_credit, 200); // (2+2−1−1)·100
  assert.equal(p.max_loss, 300); // 500 − 200
  assert.equal(p.credit_to_risk, 0.4);
  assert.equal(p.breach_lower, 595);
  assert.equal(p.breach_upper, 605);
  assert.equal(p.illiquid, false);
});

test("buildCondorPlan: a missing leg quote → no credit, illiquid", () => {
  const p = cleanCondorPlan({ shortCall: { bid: null, ask: null } });
  assert.equal(p.net_credit, null);
  assert.equal(p.max_loss, null);
  assert.equal(p.illiquid, true);
});

test("buildCondorPlan: a debit structure (wings cost more than shorts) → no credit", () => {
  const p = cleanCondorPlan({
    shortPut: { bid: 0.5, ask: 0.6 },
    shortCall: { bid: 0.5, ask: 0.6 },
    longPut: { bid: 1.9, ask: 2.0 },
    longCall: { bid: 1.9, ask: 2.0 },
  });
  assert.equal(p.net_credit, null, "a would-be debit is not a sellable condor");
});

// ══════════════════════════════════════════════════════════════════════════════════════
// 4. Condor liquidity gate
// ══════════════════════════════════════════════════════════════════════════════════════
test("condor liquidity gate: clean plan passes", () => {
  assert.deepEqual(condorLiquidityGateBlocks(cleanCondorPlan()), []);
});

test("condor liquidity gate: null plan fails closed", () => {
  const blocks = condorLiquidityGateBlocks(null);
  assert.equal(blocks[0]!.code, "condor_liquidity");
});

test("condor liquidity gate: thin credit below the floor blocks", () => {
  // credit $20 on $500 risk = 0.04 < 0.10 floor.
  const p = cleanCondorPlan({
    shortPut: { bid: 1.0, ask: 1.1 },
    shortCall: { bid: 1.0, ask: 1.1 },
    longPut: { bid: 0.9, ask: 0.9 },
    longCall: { bid: 0.9, ask: 0.9 },
  });
  assert.ok(p.credit_to_risk != null && p.credit_to_risk < CONDOR_MIN_CREDIT_TO_RISK);
  const blocks = condorLiquidityGateBlocks(p);
  assert.equal(blocks[0]!.code, "condor_liquidity");
  assert.match(blocks[0]!.reason, /below the .* floor/);
});

test("condor liquidity gate: a too-wide leg spread blocks", () => {
  // shortCall spread (3.0-1.0)/2.0 = 100% of mid ≫ 12%.
  const p = cleanCondorPlan({ shortCall: { bid: 1.0, ask: 3.0 } });
  assert.equal(p.illiquid, true);
  assert.equal(condorLiquidityGateBlocks(p)[0]!.code, "condor_liquidity");
});

// ── range-intact proxy ──
test("condorRangeBreaking: centered spot is fine; spot at a short is a break", () => {
  const p = cleanCondorPlan();
  assert.equal(condorRangeBreaking(600, p), false); // dead center
  assert.equal(condorRangeBreaking(604.5, p), true); // hugging the 605 short
  assert.equal(condorRangeBreaking(606, p), true); // already breached
});

// ══════════════════════════════════════════════════════════════════════════════════════
// 5. Gate branch by play_type — G-1 does NOT fire on a condor; condor gates DO
// ══════════════════════════════════════════════════════════════════════════════════════
function condorGateInput(overrides: Partial<ZeroDteGateInput> = {}): ZeroDteGateInput {
  const nowMs = Date.parse(`${TODAY}T15:00:00Z`); // 11:00 ET
  return {
    ticker: "SPY",
    direction: "long", // nominal — a condor is neutral
    play_type: "CONDOR",
    condorPlan: cleanCondorPlan(),
    score: 80,
    nowEtMinutes: 11 * 60,
    nowMs,
    bias: "up", // a directional LONG would clear, but we test the opposite too
    biasAsOfMs: nowMs - 60_000,
    governor: { open_plans: [], stops: [] },
    plan: null, // a condor has no single-leg plan
    intradayConflict: true, // would trip G-10 for a directional — must NOT for a condor
    halted: false,
    earnings: null,
    todayYmd: TODAY,
    macroEvents: [],
    ...overrides,
  };
}

test("G-1 does NOT fire on a condor even against a trending tape", () => {
  // A directional long into a DOWN tape blocks (tape_alignment); a condor must not.
  const v = evaluateZeroDteGates(condorGateInput({ direction: "long", bias: "down" }));
  assert.equal(v.verdict, "COMMIT", v.blocks.map((b) => b.code).join(","));
  assert.ok(!v.blocks.some((b) => b.code === "tape_alignment" || b.code === "no_market_bias"));
});

test("G-1 no_market_bias does NOT fire on a condor with a stale/absent tape", () => {
  const v = evaluateZeroDteGates(condorGateInput({ bias: null, biasAsOfMs: null }));
  assert.ok(!v.blocks.some((b) => b.code === "no_market_bias"));
});

test("G-10 / G-12 / G-6 are skipped for a condor", () => {
  const v = evaluateZeroDteGates(
    condorGateInput({
      intradayConflict: true,
      confluence: { score: 0, confirmations: 0, timing_ok: true, early_window: false, vwap_ok: false, market_ok: false, tier: "weak", label: "0" },
      slayerLive: { direction: "short" }, // opposes the nominal long — would trip G-6 directionally
    })
  );
  assert.ok(!v.blocks.some((b) => ["intraday_conflict", "confluence_floor", "cross_system_conflict"].includes(b.code)));
});

test("condor liquidity gate FIRES inside the gate stack (no priced plan)", () => {
  const v = evaluateZeroDteGates(condorGateInput({ condorPlan: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.ok(v.blocks.some((b) => b.code === "condor_liquidity"));
});

test("condor G-4: elevated VIX blocks the SALE (harder than directional)", () => {
  const v = evaluateZeroDteGates(condorGateInput({ vixDayOpen: 18 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.ok(v.blocks.some((b) => b.code === "condor_vix_regime"));
});

test("condor G-4: unavailable VIX fails the sale closed", () => {
  const v = evaluateZeroDteGates(condorGateInput({ vixDayOpen: null, vixUnavailable: true }));
  assert.ok(v.blocks.some((b) => b.code === "condor_vix_regime"));
});

test("condor G-7: a macro release today blocks the whole session", () => {
  const v = evaluateZeroDteGates(
    condorGateInput({ macroEvents: [{ event: "CPI", time: "08:30", date: TODAY }] })
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.ok(v.blocks.some((b) => b.code === "condor_macro_block"));
});

test("condor range-break FIRES when spot has crept to a short", () => {
  const p = cleanCondorPlan();
  const near = { ...p, spot: 604.6 }; // hugging the 605 short
  const v = evaluateZeroDteGates(condorGateInput({ condorPlan: near }));
  assert.ok(v.blocks.some((b) => b.code === "condor_range_break"));
});

test("a clean condor in a benign regime COMMITS", () => {
  const v = evaluateZeroDteGates(condorGateInput({ vixDayOpen: 13 }));
  assert.equal(v.verdict, "COMMIT", v.blocks.map((b) => b.code).join(","));
});

// ══════════════════════════════════════════════════════════════════════════════════════
// 6. Condor grader — close-inside=win / breach=loss
// ══════════════════════════════════════════════════════════════════════════════════════
test("grader: stays inside both shorts to close → WIN (+credit)", () => {
  const p = cleanCondorPlan();
  const bars = [barAt("14:01:00", 601, 599, 600), barAt("15:00:00", 602, 598, 601), barAt("15:30:00", 601, 600, 600.5)];
  const o = gradeCondorFromBars(bars, p, flaggedAtMs);
  assert.equal(o.outcome, "condor_win");
  assert.equal(o.realized_usd, 200);
  assert.equal(o.pnl_pct, 40); // 200/500
  assert.equal(o.breached_intraday, false);
});

test("grader: an intraday touch of a short → DEFINED breach loss (capped)", () => {
  const p = cleanCondorPlan();
  const bars = [barAt("14:01:00", 604, 600, 602), barAt("14:30:00", 606, 601, 603)]; // high 606 ≥ 605 short
  const o = gradeCondorFromBars(bars, p, flaggedAtMs);
  assert.equal(o.outcome, "condor_breach_loss");
  assert.equal(o.realized_usd, -300); // capped at max loss
  assert.equal(o.pnl_pct, -60);
  assert.equal(o.breached_intraday, true);
});

test("grader: the flag bar itself is excluded (no intrabar look-ahead)", () => {
  const p = cleanCondorPlan();
  // The flag bar breaches, but it must be ignored; the only post-flag bar stays inside → WIN.
  const bars = [
    { t: flaggedAtMs, h: 610, l: 590, c: 600 },
    barAt("15:30:00", 601, 599, 600),
  ];
  const o = gradeCondorFromBars(bars, p, flaggedAtMs);
  assert.equal(o.outcome, "condor_win");
});

test("grader: no priced credit → ungradeable", () => {
  const p = cleanCondorPlan({ shortCall: { bid: null, ask: null } });
  const o = gradeCondorFromBars([barAt("15:30:00", 601, 599, 600)], p, flaggedAtMs);
  assert.equal(o.outcome, "ungradeable");
});

// ══════════════════════════════════════════════════════════════════════════════════════
// 7. Honesty — WR surfaced ≤ 97 with the breach companion
// ══════════════════════════════════════════════════════════════════════════════════════
test("condor plan surfaces WR capped at 97 with the negative-skew breach companion", () => {
  const p = cleanCondorPlan();
  assert.ok(p.est_win_rate <= SURFACED_WIN_RATE_CAP, "never a bare 100");
  assert.equal(p.skew, "negative");
  // The shipped target-80 geometry carries its measured breach companion.
  assert.equal(p.est_intraday_breach_pct, 18.7);
});

test("a tighter (1.5%) condor's raw-100 WR is clamped to 97 + flagged small-sample", () => {
  const tight = selectIronCondor({ spot: 600, shortWidthPct: 0.015 });
  assert.ok(tight);
  const p = buildCondorPlan({
    spot: 600,
    expiry: TODAY,
    dte: 0,
    legs: tight!,
    quotes: {
      shortPut: { bid: 1.0, ask: 1.1 },
      longPut: { bid: 0.5, ask: 0.6 },
      shortCall: { bid: 1.0, ask: 1.1 },
      longCall: { bid: 0.5, ask: 0.6 },
    },
  });
  assert.equal(p.est_win_rate, SURFACED_WIN_RATE_CAP); // 97, not 100
  assert.equal(p.est_win_rate_small_sample, true);
  // A non-shipped width carries NULL breach (never a mismatched 18.7 next to a different WR).
  assert.equal(p.est_intraday_breach_pct, null);
});

// ── Assignment safety (design gap #8): condors only on cash-settled index roots ──
test("condorEligibleTicker: SPX+NDX cash-settled production allowlist; everything else excluded", () => {
  // Production default: SPX + NDX — both cash-settled, European, PM-settled daily 0DTE.
  for (const t of ["SPX", "spx", "NDX", "ndx"]) {
    assert.equal(condorEligibleTicker(t), true, `${t} is a cash-settled index → condor-eligible`);
  }
  // Everything else — other cash-settled index roots (research-only via env: XSP/RUT), American
  // ETF wrappers, and single names — is NOT eligible by default (they stay the directional fade).
  for (const t of ["XSP", "RUT", "SPY", "QQQ", "IWM", "DIA", "AAPL", "NVDA", "TSLA"]) {
    assert.equal(condorEligibleTicker(t), false, `${t} is not in the SPX+NDX production allowlist`);
  }
});
