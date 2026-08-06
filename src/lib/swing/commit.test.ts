// src/lib/swing/commit.test.ts — the LIVE commit gate (go-live 2026-07-24; graduation gate removed
// 2026-08-06 — see commit.ts's file header). Proves a WATCH candidate opens a REAL position when the THREE
// real-time gates pass — armed budget ∧ book-percent caps ∧ idempotency — REGARDLESS of calibration
// graduation (evidence-only, pinned but never blocking), and that `commitEligibleCount` still tracks the
// real graduated count as a diagnostic. Every edge case (unknown risk / missing contract / at-cap) safe.
// Pure decision core + the fail-soft executor, injected accessors (no live DB).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSwingCommitPlan,
  executeSwingCommits,
  isCommitGraduated,
  modelRiskUsd,
  isEventArchetype,
  swingCommitKey,
  swingRollCommitKey,
  type SwingCommitCandidate,
  type CommitBookPosition,
  type SwingCommitDeps,
} from "./commit.ts";
import { analyzeSwingCalibration, type SwingCalibrationRow, type SwingCalibrationReport } from "./calibration.ts";
import type { ChainContract, PlayDirection } from "../horizon-fanout.ts";
import { PRODUCTION_PORTFOLIO_BUDGET, DEFAULT_PORTFOLIO_BUDGET } from "./swing-portfolio-budget.ts";
import type { SwingArchetype, SwingSubLane } from "./taxonomy.ts";

// ── report builders — REAL graded rows run through the shipped ladder (no faked graduation) ──
function gradedRows(archetype: SwingArchetype, subLane: SwingSubLane, nWin: number, nLoss: number): SwingCalibrationRow[] {
  const rows: SwingCalibrationRow[] = [];
  // Winners score ABOVE both the archetype + sub-lane floors; losers BELOW — so the same rows graduate BOTH
  // buckets: on-signal (cleared floor) wins by ~100pt over off-signal (below floor) at n≥30 (LIMITED tier).
  for (let i = 0; i < nWin; i++) rows.push({ realized_pnl_pct: 55, graded_at: "2026-07-01T00:00:00Z", archetype, sub_lane: subLane, score: 92 });
  for (let i = 0; i < nLoss; i++) rows.push({ realized_pnl_pct: -35, graded_at: "2026-07-01T00:00:00Z", archetype, sub_lane: subLane, score: 25 });
  return rows;
}
/** A report in which EXACTLY (archetype, subLane) has both floors graduated (32 win / 12 loss → LIMITED + Δ100). */
function graduatedReport(archetype: SwingArchetype = "BREAKOUT", subLane: SwingSubLane = "STANDARD"): SwingCalibrationReport {
  return analyzeSwingCalibration(gradedRows(archetype, subLane, 32, 12));
}

// ── fixtures ──
function contract(over: Partial<ChainContract> = {}): ChainContract {
  return { ticker: "NVDA", right: "C", expiry: "2026-08-14", dte: 14, strike: 180, delta: 0.6, openInterest: 1000, bid: 5.0, ask: 5.2, mid: 5.1, ...over };
}
function candidate(over: Partial<SwingCommitCandidate> = {}): SwingCommitCandidate {
  return {
    ticker: "NVDA", direction: "LONG", archetype: "BREAKOUT", subLane: "STANDARD", score: 85,
    contract: contract(), sessionDate: "2026-07-24", ...over,
  };
}
const book = (over: Partial<CommitBookPosition> & { ticker: string }): CommitBookPosition => ({
  direction: "LONG", archetype: "BREAKOUT", commitKey: `2026-07-24:${over.ticker.toUpperCase()}:STANDARD:long`, isOvernight: true, ...over,
});

// ─── the REAL graduation integration (wire, don't weaken) ──────────────────────

test("graduation: a real 32-win/12-loss BREAKOUT×STANDARD record graduates BOTH floors via the shipped ladder", () => {
  const report = graduatedReport("BREAKOUT", "STANDARD");
  assert.equal(report.archetype_floors.find((g) => g.archetype === "BREAKOUT")!.floorGraduated, true);
  assert.equal(report.sub_lane_floors.find((g) => g.subLane === "STANDARD")!.floorGraduated, true);
  assert.equal(isCommitGraduated(report, "BREAKOUT", "STANDARD").graduated, true);
  // A different archetype / sub-lane in the SAME report is NOT graduated (no record) → not eligible.
  assert.equal(isCommitGraduated(report, "MEAN_REVERSION", "STANDARD").graduated, false);
  assert.equal(isCommitGraduated(report, "BREAKOUT", "TACTICAL").graduated, false);
  // Null archetype/sub-lane and a null report are never graduated (conservative).
  assert.equal(isCommitGraduated(report, null, "STANDARD").graduated, false);
  assert.equal(isCommitGraduated(report, "BREAKOUT", null).graduated, false);
  assert.equal(isCommitGraduated(null, "BREAKOUT", "STANDARD").graduated, false);
});

test("a thin (n<30) record does NOT graduate, but the candidate STILL commits — graduation is evidence-only", () => {
  const thin = analyzeSwingCalibration(gradedRows("BREAKOUT", "STANDARD", 8, 3)); // n=8 → RESEARCH tier
  const plan = computeSwingCommitPlan({ candidates: [candidate()], report: thin, book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.commitEligibleCount, 0, "not graduated — the diagnostic count stays 0");
  assert.equal(plan.committableCount, 1, "but the real-time gates (contract/budget/caps/idempotency) clear, so it opens");
  assert.equal(plan.decisions[0].graduated, false);
  assert.equal(plan.decisions[0].committable, true);
  assert.deepEqual(plan.decisions[0].blockedBy, []);
});

test("a null calibration report (no graded history at all) still commits — matches 0DTE's day-one live trading", () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate()], report: null, book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.commitEligibleCount, 0);
  assert.equal(plan.committableCount, 1);
  assert.equal(plan.decisions[0].graduated, false);
  assert.equal(plan.decisions[0].committable, true);
});

// ─── the happy path + the three real-time gates ────────────────────────────────

test("commit FIRES when contract-present ∧ budget-cleared ∧ caps-cleared ∧ not-open (graduation pinned, not required)", () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate()], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const d = plan.decisions[0];
  assert.equal(d.graduated, true);
  assert.equal(d.committable, true);
  assert.deepEqual(d.blockedBy, []);
  assert.equal(plan.commitEligibleCount, 1);
  assert.equal(plan.committableCount, 1);
  // The ledger row is built with the traded contract + the pinned commit-gate evidence.
  assert.ok(d.insert, "committable → an insert row is built");
  assert.equal(d.insert!.commit_key, swingCommitKey("2026-07-24", "NVDA", "STANDARD", "long"));
  assert.equal(d.insert!.sub_lane, "STANDARD");
  assert.equal(d.insert!.direction, "long");
  assert.equal(d.insert!.contract_type, "call");
  assert.equal(d.insert!.entry_premium, 5.1);
  assert.equal((d.insert!.entry_context as Record<string, unknown>).risk_usd, 510);
  assert.equal((d.insert!.gate_calibration_json as Record<string, unknown>).graduated, true);
});

test("commit pins a feature_vector with static thesis fields (pillars / iv_rank / classification meta)", () => {
  const plan = computeSwingCommitPlan({
    candidates: [
      candidate({
        pillars: {
          STRUCTURE: 0.8,
          REL_STRENGTH: 0.6,
          FLOW: 0.7,
          VOLATILITY: 0.4,
          CATALYST: null,
          REGIME: 0.5,
          DATA_QUALITY: 0.9,
        },
        presentPillars: 6,
        dataQualityDegraded: false,
        archetypeSecondary: ["FLOW_ACCUMULATION"],
        archetypeScores: { BREAKOUT: 0.9, FLOW_ACCUMULATION: 0.7 },
        classificationMargin: 0.2,
        ivRank: 37,
      }),
    ],
    report: graduatedReport(),
    book: [],
    budget: PRODUCTION_PORTFOLIO_BUDGET,
  });
  const fv = plan.decisions[0]!.insert!.feature_vector as Record<string, unknown>;
  assert.ok(fv, "feature_vector is pinned at commit");
  assert.equal(fv.snapshot_kind, "commit");
  assert.equal(fv.evidence_score, 85);
  assert.equal(fv.present_pillars, 6);
  assert.equal(fv.dq_degraded, 0);
  assert.equal(fv.pil_structure, 0.8);
  assert.equal(fv.pil_catalyst, null, "absent pillar stays null, never 0");
  assert.equal(fv.iv_rank, 37);
  assert.equal(fv.classification_margin, 0.2);
  assert.deepEqual(fv.secondary, ["FLOW_ACCUMULATION"]);
});

test("commitEligibleCount = the REAL graduated count (graduated but budget-blocked STILL counts as eligible)", () => {
  // Two graduated candidates; the 2nd is priced so its single lot exceeds the 2% per-trade cap → blocked, but it
  // is still GRADUATED, so commitEligibleCount = 2 while committableCount = 1.
  const ok = candidate({ ticker: "NVDA", score: 90 });
  const tooRich = candidate({ ticker: "AMD", score: 80, contract: contract({ ticker: "AMD", mid: 25 }) }); // $2.5k > $2k
  const plan = computeSwingCommitPlan({ candidates: [ok, tooRich], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.commitEligibleCount, 2, "both graduated → eligible count 2");
  assert.equal(plan.committableCount, 1, "only the affordable one opens");
  const amd = plan.decisions.find((d) => d.ticker === "AMD")!;
  assert.equal(amd.graduated, true);
  assert.equal(amd.committable, false);
  assert.deepEqual(amd.blockedBy, ["budget:per_position_loss"]);
});

test("an UNGRADUATED candidate (different archetype than the report covers) still commits — not counted eligible, but not blocked either", () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ archetype: "MEAN_REVERSION" })], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.commitEligibleCount, 0, "MEAN_REVERSION has no graduated record in this report");
  assert.equal(plan.decisions[0].graduated, false);
  assert.equal(plan.decisions[0].committable, true);
  assert.deepEqual(plan.decisions[0].blockedBy, []);
});

// ─── sizing ────────────────────────────────────────────────────────────────────

test("sizing: riskUsd = premium × 100 (the reference lot); null premium → unknown", () => {
  assert.equal(modelRiskUsd(5.1), 510);
  assert.equal(modelRiskUsd(0), null);
  assert.equal(modelRiskUsd(null), null);
  assert.equal(modelRiskUsd(-1), null);
  const plan = computeSwingCommitPlan({ candidates: [candidate()], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.decisions[0].riskUsd, 510);
});

// ─── budget gate (each dimension blocks; see swing-portfolio-budget.test for the dimension math) ──

test("budget: the per-trade 2% cap blocks a single lot richer than $2k", () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ contract: contract({ mid: 22 }) })], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.commitEligibleCount, 1); // graduated…
  assert.equal(plan.decisions[0].committable, false); // …but blocked
  assert.deepEqual(plan.decisions[0].blockedBy, ["budget:per_position_loss"]);
});

test("budget: a book at the overnight cap blocks a new overnight commit", () => {
  // Overnight cap 4% = $4k. Two $2k overnight positions already on the book → the new $510 overnight is blocked.
  const existing = [
    book({ ticker: "AMD", riskUsd: 2000 }),
    book({ ticker: "MSFT", riskUsd: 2000 }),
  ];
  const plan = computeSwingCommitPlan({ candidates: [candidate()], report: graduatedReport(), book: existing, budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.decisions[0].committable, false);
  assert.ok(plan.decisions[0].blockedBy.includes("budget:overnight"));
});

// ─── book-percent caps (allocation) ──────────────────────────────────────────────

test("caps: the same-week-expiry cap (max 3) blocks the 4th same-week commit", () => {
  // Four graduated names, SAME expiry week, cheap premium (budget won't bind). The 1st–3rd open; the 4th trips
  // the max-same-week-expiry cap.
  const exp = "2026-08-14";
  const cands = ["AAA", "BBB", "CCC", "DDD"].map((t, i) =>
    candidate({ ticker: t, score: 90 - i, contract: contract({ ticker: t, expiry: exp, mid: 3 }) }),
  );
  const plan = computeSwingCommitPlan({ candidates: cands, report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.committableCount, 3, "only 3 positions may share an expiry week");
  const fourth = plan.decisions.find((d) => d.ticker === "DDD")!;
  assert.equal(fourth.committable, false);
  assert.ok(fourth.blockedBy.includes("cap:max_same_week_expiry"), `4th blocked by the same-week cap (${fourth.blockedBy})`);
  // The cap-blocked candidate is otherwise fully open-able → it gets a SHADOW row instead (2026-08-06).
  assert.ok(fourth.shadowInsert, "cap-blocked-only candidate gets a shadow row");
  assert.equal(fourth.shadowInsert!.ticker, "DDD");
  assert.deepEqual(fourth.shadowInsert!.blocked_by, ["cap:max_same_week_expiry"]);
});

// ─── shadow positions (2026-08-06, member-authorized: "change the architecture to shadow trade") ──

test("shadow: a budget-blocked-only candidate gets a shadow row, counted in shadowEligibleCount", () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ contract: contract({ mid: 22 }) })], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const d = plan.decisions[0]!;
  assert.equal(d.committable, false);
  assert.ok(d.shadowInsert, "budget-blocked-only → shadow row built");
  assert.equal(plan.shadowEligibleCount, 1);
  assert.deepEqual(d.shadowInsert!.blocked_by, ["budget:per_position_loss"]);
  assert.equal(d.shadowInsert!.entry_premium, 22);
  assert.equal((d.shadowInsert!.entry_context as Record<string, unknown>).commit_gate, "swing.commit.shadow.v1");
});

test("shadow: an idempotency-blocked (already_open) candidate does NOT get a shadow row — it's already trading for real", () => {
  const existing = [book({ ticker: "NVDA", riskUsd: 510, commitKey: swingCommitKey("2026-07-24", "NVDA", "STANDARD", "long") })];
  const plan = computeSwingCommitPlan({ candidates: [candidate()], report: graduatedReport(), book: existing, budget: PRODUCTION_PORTFOLIO_BUDGET });
  const d = plan.decisions[0]!;
  assert.ok(d.blockedBy.includes("already_open"));
  assert.equal(d.shadowInsert, undefined, "already-open names are real positions already — shadow-tracking a duplicate is noise, not signal");
  assert.equal(plan.shadowEligibleCount, 0);
});

test("shadow: no_contract/unknown_premium/no_direction blocks never get a shadow row (nothing to shadow-track)", () => {
  for (const over of [{ contract: null }, { contract: contract({ mid: null }) }, { direction: null }] as const) {
    const plan = computeSwingCommitPlan({ candidates: [candidate(over)], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
    assert.equal(plan.decisions[0]!.shadowInsert, undefined, `no shadow row for ${JSON.stringify(over)}`);
  }
});

test("shadow: a candidate blocked by BOTH budget and cap still gets exactly one shadow row", () => {
  // Rich enough to trip the per-trade budget cap AND share a week with 3 already-committed names.
  const exp = "2026-08-14";
  const cheap = ["AAA", "BBB", "CCC"].map((t, i) => candidate({ ticker: t, score: 95 - i, contract: contract({ ticker: t, expiry: exp, mid: 3 }) }));
  const rich = candidate({ ticker: "ZZZ", score: 50, contract: contract({ ticker: "ZZZ", expiry: exp, mid: 22 }) });
  const plan = computeSwingCommitPlan({ candidates: [...cheap, rich], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const zzz = plan.decisions.find((d) => d.ticker === "ZZZ")!;
  assert.ok(zzz.blockedBy.some((b) => b.startsWith("budget:")));
  assert.ok(zzz.blockedBy.some((b) => b.startsWith("cap:")));
  assert.ok(zzz.shadowInsert, "blocked by multiple risk gates, still shadow-eligible (all reasons are budget/cap)");
});

// ─── idempotency ────────────────────────────────────────────────────────────────

test("idempotency: a name already OPEN under its commit_key is never re-opened", () => {
  const existing = [book({ ticker: "NVDA", riskUsd: 510, commitKey: swingCommitKey("2026-07-24", "NVDA", "STANDARD", "long") })];
  const plan = computeSwingCommitPlan({ candidates: [candidate()], report: graduatedReport(), book: existing, budget: PRODUCTION_PORTFOLIO_BUDGET });
  const d = plan.decisions[0];
  assert.equal(d.graduated, true, "still graduated (counts as eligible)…");
  assert.equal(plan.commitEligibleCount, 1);
  assert.equal(d.committable, false, "…but not re-opened");
  assert.ok(d.blockedBy.includes("already_open"));
});

test("idempotency: a name open from a PRIOR session (different commit_key) is still blocked — one thesis root per name+side+archetype", () => {
  const existing = [book({ ticker: "NVDA", riskUsd: 510, commitKey: swingCommitKey("2026-07-17", "NVDA", "STANDARD", "long"), archetype: "BREAKOUT" })];
  const plan = computeSwingCommitPlan({ candidates: [candidate({ sessionDate: "2026-07-24" })], report: graduatedReport(), book: existing, budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.decisions[0].committable, false);
  assert.ok(plan.decisions[0].blockedBy.includes("already_open"), "prior-session open blocks a same-thesis re-commit");
});

test("idempotency: a different archetype on the same name+side may commit while another thesis is open", () => {
  const existing = [book({ ticker: "NVDA", riskUsd: 510, archetype: "BREAKOUT" })];
  const plan = computeSwingCommitPlan({
    candidates: [candidate({ archetype: "MEAN_REVERSION", score: 70 })],
    report: graduatedReport("MEAN_REVERSION", "STANDARD"),
    book: existing,
    budget: PRODUCTION_PORTFOLIO_BUDGET,
  });
  const d = plan.decisions[0];
  assert.ok(!d.blockedBy.includes("already_open"), "sibling archetype is not blocked by a different open thesis");
});

// ─── edge cases (missing contract / unknown premium / no direction) — all SAFE ──

test("edge: no contract → not committable (blocked no_contract), still eligible if graduated", () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ contract: null })], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const d = plan.decisions[0];
  assert.equal(d.graduated, true, "graduation reads the intended sub-lane when no contract is attached");
  assert.equal(plan.commitEligibleCount, 1);
  assert.equal(d.committable, false);
  assert.ok(d.blockedBy.includes("no_contract"));
  assert.equal(d.insert, undefined);
});

test("edge: unknown premium (mid null) → blocked unknown_premium (never opens without an entry price)", () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ contract: contract({ mid: null }) })], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const d = plan.decisions[0];
  assert.equal(d.committable, false);
  assert.ok(d.blockedBy.includes("unknown_premium"));
});

test("edge: a direction-null (structure-only) candidate never commits", () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ direction: null })], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.equal(plan.decisions[0].committable, false);
  assert.ok(plan.decisions[0].blockedBy.includes("no_direction"));
});

test("disarmed budget path: with the DEFAULT (advisory) budget the budget gate never blocks", () => {
  // Even a $9k lot clears the DISARMED budget (advisory) — proving the budget block is enforce-gated. (Caps +
  // graduation still apply; this isolates the budget dimension.)
  const plan = computeSwingCommitPlan({ candidates: [candidate({ contract: contract({ mid: 90 }) })], report: graduatedReport(), book: [], budget: DEFAULT_PORTFOLIO_BUDGET });
  const d = plan.decisions[0];
  assert.ok(!d.blockedBy.some((b) => b.startsWith("budget:")), "disarmed budget contributes no block");
  assert.equal(d.committable, true);
});

test("determinism: same inputs → identical plan (best-first, ticker tie-break)", () => {
  const cands = [candidate({ ticker: "BBB" }), candidate({ ticker: "AAA" }), candidate({ ticker: "CCC" })];
  const a = computeSwingCommitPlan({ candidates: cands, report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const b = computeSwingCommitPlan({ candidates: [...cands], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  assert.deepEqual(a.decisions.map((d) => d.ticker), b.decisions.map((d) => d.ticker));
});

// ─── the executor (fail-soft IO shell) ───────────────────────────────────────────

test("executeSwingCommits: opens every committable position + links it; skips the rest; fail-soft on error", async () => {
  const cands = [
    candidate({ ticker: "NVDA", score: 90 }),
    candidate({ ticker: "AMD", score: 80, contract: null }), // no contract → genuinely blocked (real-time gate)
    candidate({ ticker: "BOOM", score: 70 }), // committable but the insert throws
  ];
  const plan = computeSwingCommitPlan({ candidates: cands, report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const inserted: string[] = [];
  const promoted: string[] = [];
  let nextId = 100;
  const deps: SwingCommitDeps = {
    insertPosition: async (pos) => {
      if (pos.ticker === "BOOM") throw new Error("insert boom");
      inserted.push(pos.ticker);
      return (nextId += 1);
    },
    promote: async (ticker, _dir, id) => { promoted.push(`${ticker}:${id}`); },
  };
  const res = await executeSwingCommits(deps, plan);

  assert.deepEqual(inserted, ["NVDA"], "only the committable, non-throwing position is inserted");
  assert.deepEqual(promoted, ["NVDA:101"], "the opened position's candidate is linked (promoted)");
  assert.equal(res.errors, 1, "the throwing insert is caught + tallied (fail-soft)");
  assert.ok(res.committed.find((c) => c.ticker === "NVDA")!.positionId != null);
  assert.equal(res.committed.find((c) => c.ticker === "BOOM")!.positionId, null);
  assert.ok(res.skipped.find((s) => s.ticker === "AMD"), "the contract-less candidate is in the skipped list with its reason");
  assert.ok(res.skipped.find((s) => s.ticker === "AMD")!.blockedBy.includes("no_contract"));
});

test("executeSwingCommits: an UNGRADUATED candidate commits exactly like a graduated one (no calibration report at all)", async () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ ticker: "COLD" })], report: null, book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const inserted: string[] = [];
  const deps: SwingCommitDeps = {
    insertPosition: async (pos) => { inserted.push(pos.ticker); return 1; },
  };
  const res = await executeSwingCommits(deps, plan);
  assert.deepEqual(inserted, ["COLD"]);
  assert.equal(res.committed[0]!.positionId, 1);
  assert.equal(res.skipped.length, 0);
});

test("executeSwingCommits: writes a shadow row for a budget-blocked candidate when insertShadowPosition is wired", async () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ ticker: "RICH", contract: contract({ ticker: "RICH", mid: 22 }) })], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const shadowed: string[] = [];
  const deps: SwingCommitDeps = {
    insertPosition: async () => { throw new Error("should never be called — RICH is budget-blocked, not committable"); },
    insertShadowPosition: async (pos) => { shadowed.push(pos.ticker); return 1; },
  };
  const res = await executeSwingCommits(deps, plan);
  assert.deepEqual(shadowed, ["RICH"]);
  assert.equal(res.committed.length, 0);
  assert.equal(res.shadowed[0]!.positionId, 1);
});

test("executeSwingCommits: insertShadowPosition ABSENT ⇒ no shadow tracking happens (fail-soft, mirrors insertPosition-absent)", async () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ contract: contract({ mid: 22 }) })], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const deps: SwingCommitDeps = { insertPosition: async () => 1 };
  const res = await executeSwingCommits(deps, plan);
  assert.equal(res.shadowed.length, 0);
});

test("executeSwingCommits: a throwing insertShadowPosition is fail-soft (caught + tallied)", async () => {
  const plan = computeSwingCommitPlan({ candidates: [candidate({ contract: contract({ mid: 22 }) })], report: graduatedReport(), book: [], budget: PRODUCTION_PORTFOLIO_BUDGET });
  const deps: SwingCommitDeps = {
    insertPosition: async () => 1,
    insertShadowPosition: async () => { throw new Error("shadow db down"); },
  };
  const res = await executeSwingCommits(deps, plan);
  assert.equal(res.errors, 1);
  assert.equal(res.shadowed[0]!.positionId, null);
  assert.ok(res.shadowed[0]!.error);
});

// ─── small helpers ────────────────────────────────────────────────────────────

test("helpers: event archetype set + commit_key formats", () => {
  assert.equal(isEventArchetype("EVENT_DRIVEN"), true);
  assert.equal(isEventArchetype("POST_EARNINGS_DRIFT"), true);
  assert.equal(isEventArchetype("FAILED_BREAKDOWN"), false, "structural reclaim is not event exposure");
  assert.equal(isEventArchetype("BREAKOUT"), false);
  assert.equal(isEventArchetype(null), false);
  assert.equal(swingCommitKey("2026-07-24", "nvda", "STANDARD", "long"), "2026-07-24:NVDA:STANDARD:long");
  assert.equal(swingRollCommitKey("2026-07-24", "nvda", "STANDARD", "long", 1), "2026-07-24:NVDA:STANDARD:long:r1");
  assert.notEqual(
    swingRollCommitKey("2026-07-24", "NVDA", "STANDARD", "long", 1),
    swingCommitKey("2026-07-24", "NVDA", "STANDARD", "long"),
    "a roll child key never collides with the parent key",
  );
});
