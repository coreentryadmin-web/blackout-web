// src/lib/swing/roll-plan.test.ts — the LIVE roll plan builder (go-live 2026-07-24). Proves the roll grades the
// parent from the live mark, picks a FURTHER-OUT child, and gates that child on the SAME risk rails as a commit
// (armed budget + book-percent caps + idempotency) — deferring (null) on any missing input or blocked gate so a
// roll NEVER half-executes or opens risk a gate forbids. Injected deps (no live DB/providers).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSwingRollPlan, gradeParentFromMark, type SwingRollPlanDeps } from "./roll-plan.ts";
import type { SwingManageVerdict } from "./manage.ts";
import type { SwingPositionRow } from "../db.ts";
import { PRODUCTION_PORTFOLIO_BUDGET } from "./swing-portfolio-budget.ts";
import { swingRollCommitKey, type CommitBookPosition } from "./commit.ts";
import type { ManageSyncReads } from "./manage-sync.ts";

// ── fixtures ──
function parentRow(over: Partial<SwingPositionRow> = {}): SwingPositionRow {
  return {
    id: 42, commit_key: "2026-07-01:NVDA:STANDARD:long", root_position_id: null, parent_position_id: null, roll_seq: 0,
    session_date: "2026-07-01", ticker: "NVDA", direction: "long", sub_lane: "STANDARD", archetype: "BREAKOUT",
    top_flow_strike: null, contract_strike: 150, contract_expiry: "2026-07-28", contract_type: "call", contract_occ: null,
    contract_delta: 0.6, entry_underlying_px: 148, thesis_invalidation_px: 140, target_underlying_px: 170,
    entry_premium: 5.0, last_mark: null, peak_premium: null, trough_premium: null, underlying_mfe: null, underlying_mae: null,
    realized_pnl_pct: null, entry_context: { risk_usd: 500 }, gate_calibration_json: null, feature_vector: null,
    plan_json: null, scale_out_grade: null, grade_json: null, grade_methodology: null, legacy_grade: null,
    status: "OPEN", first_seen_at: "2026-07-01T14:00:00.000Z", committed_at: "2026-07-01T14:00:00.000Z",
    closed_at: null, graded_at: null, updated_at: "2026-07-24T14:00:00.000Z", ...over,
  };
}
function verdict(over: Partial<SwingManageVerdict> = {}): SwingManageVerdict {
  return {
    action: "EXIT", rung: "expiry_risk", enforced: true, reason: "3 DTE, theta cliff",
    dteMigration: { migrate: true, reason: "low dte" },
    rollIntent: { roll: true, reason: "still-valid thesis at low DTE" }, ...over,
  };
}
const reads = (over: Partial<ManageSyncReads> = {}): ManageSyncReads => ({ mark: 6.0, underlyingPrice: 150, dte: 3, ...over });
// A liquid STANDARD (≈14 DTE from the 2026-07-25 session) call → strictly further out than the parent's 3 DTE.
function chain(expiry = "2026-08-08") {
  return [{ expiry, strike: 150, call_bid: 5.9, call_ask: 6.1, call_delta: 0.6, call_oi: 1500, put_bid: 4.4, put_ask: 4.7, put_delta: -0.4, put_oi: 800 }];
}
function deps(over: Partial<SwingRollPlanDeps> = {}): SwingRollPlanDeps {
  return { fetchChainRows: async () => chain(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET, sessionDay: "2026-07-25", ...over };
}

// ─── parent grade freeze ──────────────────────────────────────────────────────

test("gradeParentFromMark: realized P&L% = (mark − entry)/entry × 100; null when unusable", () => {
  const g = gradeParentFromMark(parentRow({ entry_premium: 5 }), 6);
  assert.equal(g!.realized_pnl_pct, 20);
  assert.equal(g!.grade_methodology, "swing.roll.markfreeze.v1");
  // A LOSING parent is frozen as a loss (never laundered by the roll).
  assert.equal(gradeParentFromMark(parentRow({ entry_premium: 5 }), 3)!.realized_pnl_pct, -40);
  // Unusable inputs → null (defer, never a fabricated grade).
  assert.equal(gradeParentFromMark(parentRow({ entry_premium: 5 }), null), null);
  assert.equal(gradeParentFromMark(parentRow({ entry_premium: null }), 6), null);
  assert.equal(gradeParentFromMark(parentRow({ entry_premium: 0 }), 6), null);
});

// ─── ROLL happy path ────────────────────────────────────────────────────────────

test("ROLL: grades the parent + builds a gated, further-out child leg", async () => {
  const plan = await buildSwingRollPlan(parentRow(), verdict(), reads(), deps());
  assert.ok(plan, "a plan is returned");
  assert.equal(plan!.parentGrade.realized_pnl_pct, 20, "(6-5)/5*100");
  assert.ok(plan!.childSpec, "a ROLL carries a child spec");
  const child = plan!.childSpec!;
  assert.equal(child.commit_key, swingRollCommitKey("2026-07-25", "NVDA", "STANDARD", "long", 1), "child key carries the roll generation");
  assert.equal(child.ticker, "NVDA");
  assert.equal(child.direction, "long");
  assert.equal(child.sub_lane, "STANDARD");
  assert.equal(child.contract_expiry, "2026-08-08");
  assert.equal(child.contract_type, "call");
  assert.equal(child.entry_premium, 6.0);
  assert.equal((child.entry_context as Record<string, unknown>).rolled_from_position_id, 42);
  assert.equal((child.entry_context as Record<string, unknown>).roll_seq, 1);
});

test("ROLL uses the latched last_mark when the live reads carry no mark", async () => {
  const plan = await buildSwingRollPlan(parentRow({ last_mark: 7.0, entry_premium: 5 }), verdict(), reads({ mark: null }), deps());
  assert.ok(plan, "falls back to the ledger's last_mark");
  assert.equal(plan!.parentGrade.realized_pnl_pct, 40, "(7-5)/5*100");
});

// ─── CLOSE (thesis broken / no valid roll) ────────────────────────────────────────

test("CLOSE: a gating rung with NO valid-thesis roll grades + closes the parent, NO child", async () => {
  const plan = await buildSwingRollPlan(parentRow(), verdict({ rung: "thesis_stop", rollIntent: { roll: false, reason: "thesis broken" } }), reads(), deps());
  assert.ok(plan, "a CLOSE plan is returned");
  assert.equal(plan!.childSpec, undefined, "a CLOSE opens no child");
  assert.ok(plan!.parentGrade, "the parent is still graded + closed");
});

// ─── DEFER (null) cases ──────────────────────────────────────────────────────────

test("DEFER: no usable mark (live or latched) → null (never a fabricated parent grade)", async () => {
  const plan = await buildSwingRollPlan(parentRow({ last_mark: null }), verdict(), reads({ mark: null }), deps());
  assert.equal(plan, null);
});

test("DEFER: an edge/hold rung (non-gating) never rolls → null", async () => {
  const plan = await buildSwingRollPlan(parentRow(), verdict({ rung: "profit_ladder", enforced: false }), reads(), deps());
  assert.equal(plan, null);
});

test("DEFER: no chain / no liquid further-out contract → null", async () => {
  assert.equal(await buildSwingRollPlan(parentRow(), verdict(), reads(), deps({ fetchChainRows: async () => [] })), null);
});

test("DEFER: the only child contract is NOT further out than the parent (never roll flat/nearer)", async () => {
  // Parent at 20 DTE; the child chain is ~14 DTE → NOT further out → defer (a roll must buy time).
  const near = await buildSwingRollPlan(parentRow(), verdict(), reads({ dte: 20 }), deps());
  assert.equal(near, null);
});

// ─── the child clears the SAME risk rails as a commit ──────────────────────────────

test("DEFER: the child budget gate blocks a lot richer than the 2% per-trade cap", async () => {
  // A $25/share child → $2.5k model risk > $2k per-position cap → blocked → defer.
  const rich = await buildSwingRollPlan(parentRow(), verdict(), reads(),
    deps({ fetchChainRows: async () => [{ expiry: "2026-08-08", strike: 150, call_bid: 24.8, call_ask: 25.2, call_delta: 0.6, call_oi: 1500, put_bid: 1, put_ask: 1.2, put_delta: -0.4, put_oi: 100 }] }));
  assert.equal(rich, null, "the child budget gate defers the roll");
});

test("DEFER: budget removes the CLOSING parent — a roll that fits after freeing the parent's risk still opens", async () => {
  // Book heat is exactly at the 6% ($6k) portfolio cap, ALL of it the parent. The roll closes the parent (frees
  // $6k) and opens a $600 child → after removing the parent it fits. Proves the gate nets the parent out.
  const book: CommitBookPosition[] = [{ ticker: "NVDA", direction: "LONG", commitKey: "2026-07-01:NVDA:STANDARD:long", riskUsd: 6000, isOvernight: true }];
  const plan = await buildSwingRollPlan(parentRow(), verdict(), reads(), deps({ book }));
  assert.ok(plan?.childSpec, "the roll opens because the closing parent's risk is netted out of the budget");
});

// ─── same-pass book growth (FINDINGS 2026-08-06 P1) ────────────────────────────────

test("book growth: a successful ROLL swaps the closing parent for the new child IN PLACE on the caller's shared book array", async () => {
  const book: CommitBookPosition[] = [{ ticker: "NVDA", direction: "LONG", commitKey: "2026-07-01:NVDA:STANDARD:long", riskUsd: 500, isOvernight: true }];
  const plan = await buildSwingRollPlan(parentRow(), verdict(), reads(), deps({ book }));
  assert.ok(plan?.childSpec);
  assert.equal(book.some((p) => p.commitKey === "2026-07-01:NVDA:STANDARD:long"), false, "the closing parent is removed from the shared book");
  const childKey = swingRollCommitKey("2026-07-25", "NVDA", "STANDARD", "long", 1);
  assert.ok(book.some((p) => p.commitKey === childKey), "the new child is added to the shared book");
});

test("book growth: a SECOND same-pass roll sees the FIRST roll's child risk (not a stale top-of-run snapshot) and gets blocked by the aggregate overnight cap", async () => {
  // A pre-existing, untouched-by-either-roll book position (2000 overnight risk) plus two ~1900-risk rolls
  // (each individually well under the 2000 per-position cap) sums past the 4000 (4%) overnight cap ONLY in
  // aggregate. The active-refresh cron's `rollBook` used to be a single snapshot fetched once at the top of
  // the run and reused unmutated for every position's roll-gate check that pass — so a second same-pass roll
  // would evaluate against a book that reflected NEITHER roll's addition, letting both clear a check that
  // should have rejected the second. Passing the SAME `book` array into both calls (as the cron now does)
  // reproduces the fix: the second call must see the first roll's child already counted.
  const book: CommitBookPosition[] = [{ ticker: "AAPL", direction: "LONG", commitKey: "existing:AAPL:standing", riskUsd: 2000, isOvernight: true }];
  const richChain = () => [{ expiry: "2026-08-08", strike: 150, call_bid: 18.8, call_ask: 19.2, call_delta: 0.6, call_oi: 1500, put_bid: 1, put_ask: 1.2, put_delta: -0.4, put_oi: 100 }];

  const first = await buildSwingRollPlan(parentRow(), verdict(), reads(), deps({ book, fetchChainRows: async () => richChain() }));
  assert.ok(first?.childSpec, "first roll (NVDA) opens: 2000 (AAPL) + 1900 (NVDA child) = 3900, under the 4000 overnight cap");

  const second = await buildSwingRollPlan(
    parentRow({ id: 99, commit_key: "2026-07-01:TSLA:STANDARD:long", ticker: "TSLA" }),
    verdict(),
    reads(),
    deps({ book, fetchChainRows: async () => richChain() }),
  );
  assert.equal(
    second,
    null,
    "second roll (TSLA) is blocked: 2000 (AAPL) + 1900 (NVDA child, now IN the shared book) + 1900 (TSLA candidate) breaches the 4000 overnight cap",
  );
});

test("DEFER: idempotency — a child already open under this roll generation is not re-rolled", async () => {
  const childKey = swingRollCommitKey("2026-07-25", "NVDA", "STANDARD", "long", 1);
  const book: CommitBookPosition[] = [{ ticker: "NVDA", direction: "LONG", commitKey: childKey, riskUsd: 600, isOvernight: true }];
  const plan = await buildSwingRollPlan(parentRow(), verdict(), reads(), deps({ book }));
  assert.equal(plan, null, "the roll already happened → do not re-roll");
});
