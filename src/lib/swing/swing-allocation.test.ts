import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateSwingBook,
  expiryWeekKey,
  DEFAULT_SWING_CAPS,
  CLUSTER_POLICY,
  type SwingAllocationCandidate,
} from "./swing-allocation.ts";
import { DEFAULT_PORTFOLIO_BUDGET, type PortfolioBudget } from "./swing-portfolio-budget.ts";

const cand = (
  ticker: string,
  score: number,
  extra: Partial<SwingAllocationCandidate> = {},
): SwingAllocationCandidate => ({ ticker, direction: "LONG", score, ...extra });

test("four-name cluster (NVDA+AMD+SMH+QQQ) collapses to ONE theme and AGGREGATES against the 20% cap", () => {
  const res = allocateSwingBook([cand("NVDA", 90), cand("AMD", 88), cand("SMH", 86), cand("QQQ", 84)]);
  // All four resolve to the single "semis" theme (ETF proxies included) — the SEV-9 collapse.
  for (const d of res.decisions) assert.equal(d.theme, "semis", `${d.ticker} → semis`);
  // 4 × 5% aggregates to exactly the 20% theme cap (AGGREGATE_CAP: summed, not counted).
  const last = res.decisions[res.decisions.length - 1];
  assert.equal(last.themeAggregatePct, 20);
  // At exactly the cap (20 == 20, not > 20) nothing breaches yet.
  assert.equal(res.capsApplied.themesOverCap.length, 0);
  assert.equal(res.capsApplied.clusterPolicy, CLUSTER_POLICY);
});

test("a FIFTH same-theme name pushes the aggregate over the 20% cap and is flagged", () => {
  const res = allocateSwingBook([
    cand("NVDA", 90),
    cand("AMD", 88),
    cand("SMH", 86),
    cand("QQQ", 84),
    cand("AVGO", 82),
  ]);
  const avgo = res.decisions.find((d) => d.ticker === "AVGO");
  assert.ok(avgo);
  assert.equal(avgo?.theme, "semis");
  assert.equal(avgo?.themeAggregatePct, 25);
  const flag = avgo?.capFlags.find((f) => f.cap === "per_theme_sector");
  assert.equal(flag?.wouldBreach, true);
  assert.deepEqual(res.capsApplied.themesOverCap, ["semis"]);
  assert.equal(avgo?.advisorySizing, "SKIP");
});

test("NOTHING is resized when enforce:false — proposedPct constant, every candidate survives", () => {
  const cands = [cand("NVDA", 90), cand("AMD", 88), cand("SMH", 86), cand("QQQ", 84), cand("AVGO", 82)];
  const res = allocateSwingBook(cands);
  assert.equal(res.enforce, false);
  assert.equal(res.decisions.length, cands.length); // none dropped
  for (const d of res.decisions) assert.equal(d.proposedPct, DEFAULT_SWING_CAPS.perPositionPct); // never resized
});

test("max-3-same-week rule flags the 4th same-week expiry (distinct themes, so only the week cap fires)", () => {
  const exp = "2026-08-21"; // a single Friday → one Mon–Sun week
  const res = allocateSwingBook([
    cand("XOM", 90, { expiry: exp }), // energy
    cand("LLY", 88, { expiry: exp }), // healthcare
    cand("JPM", 86, { expiry: exp }), // financials
    cand("NKE", 84, { expiry: exp }), // consumer
  ]);
  // themes are all distinct → the theme cap never fires; only the same-week cluster cap does.
  assert.equal(res.capsApplied.themesOverCap.length, 0);
  const fourth = res.decisions[res.decisions.length - 1];
  const weekFlag = fourth.capFlags.find((f) => f.cap === "max_same_week_expiry");
  assert.equal(weekFlag?.wouldBreach, true);
  assert.equal(weekFlag?.observed, 4);
  assert.deepEqual(res.capsApplied.weeksOverCap, [expiryWeekKey(exp)]);
  // the first three in the week do NOT breach
  const third = res.decisions[2];
  assert.equal(third.capFlags.find((f) => f.cap === "max_same_week_expiry")?.wouldBreach, false);
});

test("total-in-swings cap fires once the sleeve exceeds 40% of the book (distinct themes)", () => {
  // 9 distinct-theme names × 5% = 45% > 40% → the 9th breaches total_in_swings.
  const tickers = ["XOM", "LLY", "JPM", "NKE", "NVDA", "COIN", "BABA", "TSLA", "PLTR"];
  const res = allocateSwingBook(tickers.map((t, i) => cand(t, 90 - i)));
  assert.equal(res.capsApplied.totalInSwingsOverCap, true);
  const ninth = res.decisions[8];
  assert.equal(ninth.bookAggregatePct, 45);
  assert.equal(ninth.capFlags.find((f) => f.cap === "total_in_swings")?.wouldBreach, true);
});

test("existing exposure SEEDS the running aggregate — a single new semi add can breach", () => {
  // Book already 20% semis (4 × 5%) → the FIRST new semi candidate breaches the theme cap.
  const existing = ["NVDA", "AMD", "SMH", "QQQ"].map((t) => ({ ticker: t, direction: "LONG" as const }));
  const res = allocateSwingBook([cand("AVGO", 95)], existing);
  const avgo = res.decisions[0];
  assert.equal(avgo.themeAggregatePct, 25); // 20 seeded + 5
  assert.equal(avgo.capFlags.find((f) => f.cap === "per_theme_sector")?.wouldBreach, true);
  // still advisory: not resized, still in output.
  assert.equal(avgo.proposedPct, 5);
  assert.equal(res.enforce, false);
});

test("empty book is a valid case — a within-caps single name is clean FULL", () => {
  const res = allocateSwingBook([cand("XOM", 90, { expiry: "2026-08-21" })]);
  const d = res.decisions[0];
  assert.equal(d.advisorySizing, "FULL");
  assert.ok(d.capFlags.every((f) => !f.wouldBreach));
  assert.equal(res.capsApplied.totalInSwingsOverCap, false);
});

test("portfolio budget default is a NO-OP — decisions/capsApplied IDENTICAL, verdict clean", () => {
  const cands = [cand("NVDA", 90), cand("AMD", 88), cand("SMH", 86), cand("QQQ", 84), cand("AVGO", 82)];
  // Baseline: no budget arg (uses DEFAULT_PORTFOLIO_BUDGET internally).
  const baseline = allocateSwingBook(cands);
  // Explicitly passing the default budget must yield BYTE-IDENTICAL decisions + capsApplied.
  const withDefault = allocateSwingBook(cands, [], DEFAULT_SWING_CAPS, DEFAULT_PORTFOLIO_BUDGET);
  assert.deepEqual(withDefault.decisions, baseline.decisions);
  assert.deepEqual(withDefault.capsApplied, baseline.capsApplied);
  // The advisory verdict itself is a clean no-op under the default.
  assert.equal(baseline.portfolioBudget.enforce, false);
  assert.equal(baseline.portfolioBudget.advisoryBreaches.length, 0);
  assert.equal(baseline.portfolioBudget.hardExceeded.length, 0);
  for (const d of baseline.portfolioBudget.verdicts) assert.equal(d.constrained, false);
});

test("an ARMED budget still does NOT change allocation — only the verdict differs (no-op on decisions)", () => {
  const cands = [cand("NVDA", 90), cand("AMD", 88)];
  const baseline = allocateSwingBook(cands);
  // Arm a budget with capital + a tiny per-position cap; even enforce:true must not touch decisions,
  // because the live allocator passes only tickers (no riskUsd) — the verdict is informational only.
  const armed: PortfolioBudget = {
    ...DEFAULT_PORTFOLIO_BUDGET,
    capitalUsd: 100_000,
    maxPortfolioLossPct: 1,
    enforce: true,
  };
  const withArmed = allocateSwingBook(cands, [], DEFAULT_SWING_CAPS, armed);
  assert.deepEqual(withArmed.decisions, baseline.decisions); // allocation UNCHANGED
  assert.deepEqual(withArmed.capsApplied, baseline.capsApplied);
  // With no riskUsd on the positions the observed risk is 0 → no breach even armed.
  assert.equal(withArmed.portfolioBudget.enforce, true);
  assert.equal(withArmed.portfolioBudget.hardExceeded.length, 0);
});

test("expiryWeekKey buckets two dates in the same Mon–Sun week together, distinct weeks apart", () => {
  assert.equal(expiryWeekKey("2026-08-19"), expiryWeekKey("2026-08-21")); // same week
  assert.notEqual(expiryWeekKey("2026-08-21"), expiryWeekKey("2026-08-28")); // next week
  assert.equal(expiryWeekKey(null), null);
  assert.equal(expiryWeekKey("not-a-date"), null);
});
