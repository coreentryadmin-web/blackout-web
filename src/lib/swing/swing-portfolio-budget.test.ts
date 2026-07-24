import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePortfolioBudget,
  evaluateSwingCommitBudget,
  resolveProductionPortfolioBudget,
  budgetRiskUsd,
  DEFAULT_PORTFOLIO_BUDGET,
  PRODUCTION_PORTFOLIO_BUDGET,
  type PortfolioBudget,
  type BudgetPosition,
} from "./swing-portfolio-budget.ts";

const pos = (ticker: string, extra: Partial<BudgetPosition> = {}): BudgetPosition => ({ ticker, ...extra });

test("DEFAULT_PORTFOLIO_BUDGET is all-null and advisory (enforce:false)", () => {
  assert.equal(DEFAULT_PORTFOLIO_BUDGET.capitalUsd, null);
  assert.equal(DEFAULT_PORTFOLIO_BUDGET.maxPortfolioLossPct, null);
  assert.equal(DEFAULT_PORTFOLIO_BUDGET.perPositionLossPct, null);
  assert.equal(DEFAULT_PORTFOLIO_BUDGET.eventExposureCap, null);
  assert.equal(DEFAULT_PORTFOLIO_BUDGET.overnightCap, null);
  assert.equal(DEFAULT_PORTFOLIO_BUDGET.enforce, false);
});

test("null limits ⇒ every dimension unconstrained, ZERO advisory breaches (the default is a no-op)", () => {
  const positions = [pos("NVDA", { riskUsd: 999999, isEvent: true, isOvernight: true })]; // huge risk, still no cap set
  const v = evaluatePortfolioBudget(positions); // default budget
  assert.equal(v.enforce, false);
  assert.equal(v.advisoryBreaches.length, 0);
  assert.equal(v.hardExceeded.length, 0);
  for (const d of v.verdicts) {
    assert.equal(d.constrained, false, `${d.dimension} unconstrained`);
    assert.equal(d.wouldBreach, false);
    assert.equal(d.limitUsd, null);
  }
});

test("capital null but a pct set ⇒ STILL unconstrained (a % of unknown capital is unknown)", () => {
  const budget: PortfolioBudget = { ...DEFAULT_PORTFOLIO_BUDGET, maxPortfolioLossPct: 10 };
  const v = evaluatePortfolioBudget([pos("NVDA", { riskUsd: 50000 })], budget);
  const dim = v.verdicts.find((d) => d.dimension === "portfolio_loss")!;
  assert.equal(dim.constrained, false);
  assert.equal(dim.wouldBreach, false);
  assert.equal(v.advisoryBreaches.length, 0);
});

test("enforce:false with a SET limit that would breach ⇒ advisory flag present, but hardExceeded empty", () => {
  // $100k capital, 5% portfolio-loss cap = $5k limit; positions risk $8k total → advisory would-breach.
  const budget: PortfolioBudget = {
    ...DEFAULT_PORTFOLIO_BUDGET,
    capitalUsd: 100_000,
    maxPortfolioLossPct: 5,
    enforce: false,
  };
  const v = evaluatePortfolioBudget([pos("NVDA", { riskUsd: 5000 }), pos("AMD", { riskUsd: 3000 })], budget);
  const dim = v.verdicts.find((d) => d.dimension === "portfolio_loss")!;
  assert.equal(dim.constrained, true);
  assert.equal(dim.limitUsd, 5000);
  assert.equal(dim.observedUsd, 8000);
  assert.equal(dim.wouldBreach, true); // advisory flag IS present
  assert.deepEqual(v.advisoryBreaches, ["portfolio_loss"]);
  assert.equal(v.hardExceeded.length, 0); // …but NOT hard — enforce:false
});

test("enforce:true + set limit + breach ⇒ HARD would-exceed verdict", () => {
  const budget: PortfolioBudget = {
    ...DEFAULT_PORTFOLIO_BUDGET,
    capitalUsd: 100_000,
    maxPortfolioLossPct: 5,
    enforce: true,
  };
  const v = evaluatePortfolioBudget([pos("NVDA", { riskUsd: 5000 }), pos("AMD", { riskUsd: 3000 })], budget);
  assert.deepEqual(v.advisoryBreaches, ["portfolio_loss"]);
  assert.deepEqual(v.hardExceeded, ["portfolio_loss"]); // armed → hard verdict
});

test("per-position cap flags the single oversized position (and names the offender)", () => {
  const budget: PortfolioBudget = {
    ...DEFAULT_PORTFOLIO_BUDGET,
    capitalUsd: 100_000,
    perPositionLossPct: 2, // $2k per position
    enforce: true,
  };
  const v = evaluatePortfolioBudget([pos("NVDA", { riskUsd: 3000 }), pos("AMD", { riskUsd: 1000 })], budget);
  const dim = v.verdicts.find((d) => d.dimension === "per_position_loss")!;
  assert.equal(dim.wouldBreach, true);
  assert.deepEqual(dim.offenders, ["NVDA"]); // only NVDA exceeds $2k
  assert.deepEqual(v.hardExceeded, ["per_position_loss"]);
});

test("event + overnight caps only count their tagged positions", () => {
  const budget: PortfolioBudget = {
    ...DEFAULT_PORTFOLIO_BUDGET,
    capitalUsd: 100_000,
    eventExposureCap: 3, // $3k of event risk
    overnightCap: 3, // $3k of overnight risk
    enforce: true,
  };
  const positions = [
    pos("NVDA", { riskUsd: 4000, isEvent: true, isOvernight: false }), // event only, over $3k
    pos("AMD", { riskUsd: 1000, isEvent: false, isOvernight: true }), // overnight only, under $3k
  ];
  const v = evaluatePortfolioBudget(positions, budget);
  const ev = v.verdicts.find((d) => d.dimension === "event_exposure")!;
  const on = v.verdicts.find((d) => d.dimension === "overnight")!;
  assert.equal(ev.observedUsd, 4000);
  assert.equal(ev.wouldBreach, true);
  assert.equal(on.observedUsd, 1000);
  assert.equal(on.wouldBreach, false);
  assert.deepEqual(v.hardExceeded, ["event_exposure"]);
});

test("at exactly the limit (==, not >) nothing breaches", () => {
  const budget: PortfolioBudget = {
    ...DEFAULT_PORTFOLIO_BUDGET,
    capitalUsd: 100_000,
    maxPortfolioLossPct: 5, // exactly $5k
    enforce: true,
  };
  const v = evaluatePortfolioBudget([pos("NVDA", { riskUsd: 5000 })], budget);
  assert.equal(v.verdicts.find((d) => d.dimension === "portfolio_loss")!.wouldBreach, false);
  assert.equal(v.hardExceeded.length, 0);
});

// ─── ARMED production budget (go-live) ────────────────────────────────────────

test("PRODUCTION_PORTFOLIO_BUDGET carries the operator-delegated numbers and is ARMED", () => {
  assert.equal(PRODUCTION_PORTFOLIO_BUDGET.capitalUsd, 100_000);
  assert.equal(PRODUCTION_PORTFOLIO_BUDGET.maxPortfolioLossPct, 6);
  assert.equal(PRODUCTION_PORTFOLIO_BUDGET.perPositionLossPct, 2);
  assert.equal(PRODUCTION_PORTFOLIO_BUDGET.eventExposureCap, 3);
  assert.equal(PRODUCTION_PORTFOLIO_BUDGET.overnightCap, 4);
  assert.equal(PRODUCTION_PORTFOLIO_BUDGET.enforce, true);
  // DEFAULT stays disarmed (the pure-test no-op).
  assert.equal(DEFAULT_PORTFOLIO_BUDGET.enforce, false);
});

test("resolveProductionPortfolioBudget: defaults to the constants; env overrides; malformed→fallback; disarm flag", () => {
  assert.deepEqual(resolveProductionPortfolioBudget({}), PRODUCTION_PORTFOLIO_BUDGET);
  const overridden = resolveProductionPortfolioBudget({
    SWING_CAPITAL_USD: "250000",
    SWING_MAX_PORTFOLIO_LOSS_PCT: "8",
    SWING_PER_POSITION_LOSS_PCT: "1.5",
    SWING_EVENT_EXPOSURE_CAP: "garbage", // malformed → fallback to 3
    SWING_OVERNIGHT_CAP: "0", // non-positive → fallback to 4 (a hollow 0 could open the gate)
  });
  assert.equal(overridden.capitalUsd, 250_000);
  assert.equal(overridden.maxPortfolioLossPct, 8);
  assert.equal(overridden.perPositionLossPct, 1.5);
  assert.equal(overridden.eventExposureCap, 3, "malformed override falls back to the constant");
  assert.equal(overridden.overnightCap, 4, "non-positive override falls back to the constant");
  assert.equal(overridden.enforce, true, "stays ARMED by default");
  // Explicit disarm.
  assert.equal(resolveProductionPortfolioBudget({ SWING_BUDGET_ENFORCE: "0" }).enforce, false);
  assert.equal(resolveProductionPortfolioBudget({ SWING_BUDGET_ENFORCE: "false" }).enforce, false);
  assert.equal(resolveProductionPortfolioBudget({ SWING_BUDGET_ENFORCE: "1" }).enforce, true);
});

// ─── evaluateSwingCommitBudget (the HARD pre-commit gate) ──────────────────────

test("commit budget: candidate that fits under every cap is NOT blocked", () => {
  // $100k ref; a $1.5k model position; book already holds one $1.5k position → $3k total < 6% ($6k). Clear.
  const book = [pos("AMD", { riskUsd: 1500, isOvernight: true })];
  const v = evaluateSwingCommitBudget(book, pos("NVDA", { riskUsd: 1500, isOvernight: true }), PRODUCTION_PORTFOLIO_BUDGET);
  assert.equal(v.blocked, false);
  assert.deepEqual(v.blockedDimensions, []);
});

test("commit budget: a single position over the 2% per-trade cap is BLOCKED (its own offender)", () => {
  // premium $25/share → $2.5k model risk > $2k per-position cap.
  const v = evaluateSwingCommitBudget([], pos("NVDA", { riskUsd: 2500, isOvernight: true }), PRODUCTION_PORTFOLIO_BUDGET);
  assert.equal(v.blocked, true);
  assert.deepEqual(v.blockedDimensions, ["per_position_loss"]);
});

test("commit budget: book at the overnight cap BLOCKS a new overnight commit until room frees", () => {
  // Overnight cap 4% = $4k. Book already holds $4k of overnight risk (2 × $2k) → a new $1k overnight is blocked.
  const book = [pos("AMD", { riskUsd: 2000, isOvernight: true }), pos("MSFT", { riskUsd: 2000, isOvernight: true })];
  const v = evaluateSwingCommitBudget(book, pos("NVDA", { riskUsd: 1000, isOvernight: true }), PRODUCTION_PORTFOLIO_BUDGET);
  assert.equal(v.blocked, true);
  assert.ok(v.blockedDimensions.includes("overnight"), "overnight cap blocks the new commit");
});

test("commit budget: a NON-event candidate is NOT blocked by an event-cap breach it doesn't contribute to", () => {
  // Event cap 3% = $3k. Existing event names already breach it, but the new candidate is NOT event → it must
  // not be blocked for a dimension it doesn't touch (only the aggregate dims it contributes to can block it).
  const budget = { ...PRODUCTION_PORTFOLIO_BUDGET, maxPortfolioLossPct: 50, overnightCap: 50 }; // relax the others
  const book = [pos("MRNA", { riskUsd: 3500, isEvent: true, isOvernight: true })]; // event already over $3k
  const v = evaluateSwingCommitBudget(book, pos("NVDA", { riskUsd: 500, isEvent: false, isOvernight: true }), budget);
  assert.equal(v.blocked, false, "the non-event candidate doesn't contribute to the event breach");
});

test("commit budget: unknown/zero risk contributes 0 and is never blocked (don't block on unknown)", () => {
  const book = [pos("AMD", { riskUsd: 5900, isOvernight: true })]; // book near the 6% portfolio cap
  const v = evaluateSwingCommitBudget(book, pos("NVDA", { riskUsd: null, isOvernight: true }), PRODUCTION_PORTFOLIO_BUDGET);
  assert.equal(v.candidateRiskUsd, 0);
  assert.equal(v.blocked, false, "an unknown-risk candidate contributes 0 → never blocks");
  assert.equal(budgetRiskUsd(pos("X", { riskUsd: -5 })), 0, "negative risk clamps to 0");
});

test("commit budget: disarmed budget NEVER blocks (advisory only)", () => {
  const v = evaluateSwingCommitBudget([], pos("NVDA", { riskUsd: 999_999, isOvernight: true }), DEFAULT_PORTFOLIO_BUDGET);
  assert.equal(v.blocked, false);
  assert.equal(v.enforce, false);
});
