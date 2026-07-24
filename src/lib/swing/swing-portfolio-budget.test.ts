import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePortfolioBudget,
  DEFAULT_PORTFOLIO_BUDGET,
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
