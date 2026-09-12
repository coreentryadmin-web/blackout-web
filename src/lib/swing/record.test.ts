import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSwingRecord,
  buildSwingRecordSummary,
  isSwingWin,
  LOW_N_THRESHOLD,
  type SwingLegRowLike,
} from "./record.ts";
import { roundFloats } from "../round-floats.ts";

let idSeq = 1;
function leg(overrides: Partial<SwingLegRowLike> = {}): SwingLegRowLike {
  return {
    id: idSeq++,
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    ticker: "NVDA",
    direction: "long",
    status: "GRADED",
    realized_pnl_pct: 100,
    graded_at: "2026-07-25T00:00:00.000Z",
    grade_json: { v: 1 },
    ...overrides,
  };
}

test("isSwingWin mirrors pnl>0", () => {
  assert.equal(isSwingWin(1), true);
  assert.equal(isSwingWin(0), false);
  assert.equal(isSwingWin(-5), false);
  assert.equal(isSwingWin(null), false);
});

// ── THE invariant: a roll composite PRESERVES a parent loss, never nets it away ───
test("roll chain composite preserves a parent loss — a winning child does NOT net it away", () => {
  const root = 10;
  const parent = leg({ id: root, root_position_id: null, roll_seq: 0, status: "ROLLED", realized_pnl_pct: -50 });
  const child = leg({ id: 11, root_position_id: root, parent_position_id: root, roll_seq: 1, realized_pnl_pct: 100 });

  const rec = buildSwingRecord([child, parent]); // deliberately out of order
  const c = rec.composite;

  // Money view is UP: sum = +50, compounded = (0.5 × 2 − 1) = 0% — either way, not negative.
  assert.equal(c.sumPnlPct, 50);
  assert.equal(c.compoundedReturnPct, 0);
  // …but the OUTCOME is a LOSS: the parent's loss is preserved, the winning child cannot launder it.
  assert.equal(c.allLegsWon, false);
  assert.equal(c.outcome, "loss");
  assert.equal(c.wins, 1);
  assert.equal(c.losses, 1);
  assert.equal(c.worstLegPnlPct, -50); // the preserved-loss witness
  // Legs are ordered by roll_seq and keep their own frozen grade.
  assert.deepEqual(rec.legs.map((l) => l.rollSeq), [0, 1]);
  assert.equal(rec.legs[0]!.win, false);
  assert.equal(rec.legs[1]!.win, true);
  assert.equal(rec.rootPositionId, root);
});

test("all-winning chain composites to a win", () => {
  const root = 20;
  const rec = buildSwingRecord([
    leg({ id: root, roll_seq: 0, status: "ROLLED", realized_pnl_pct: 30 }),
    leg({ id: 21, root_position_id: root, parent_position_id: root, roll_seq: 1, realized_pnl_pct: 50 }),
  ]);
  assert.equal(rec.composite.allLegsWon, true);
  assert.equal(rec.composite.outcome, "win");
  assert.equal(rec.composite.chainResolved, true);
  assert.equal(rec.composite.losses, 0);
  assert.equal(rec.composite.worstLegPnlPct, 30);
});

test("a WON parent with a still-OPEN child is NOT yet a 'win' — the chain hasn't resolved (FINDINGS 2026-08-06 P3)", () => {
  // Repro: gradedLegs.length > 0 and allLegsWon (the only graded leg won), but the most recent leg (the
  // child, roll_seq 1) is still OPEN — a "win" label here would be premature evidence: if that child later
  // grades a loss, the chain was never actually a win. Must report "open" until the last leg is graded.
  const root = 50;
  const rec = buildSwingRecord([
    leg({ id: root, roll_seq: 0, status: "ROLLED", realized_pnl_pct: 40 }),
    leg({ id: 51, root_position_id: root, parent_position_id: root, roll_seq: 1, status: "OPEN", realized_pnl_pct: null, graded_at: null }),
  ]);
  const c = rec.composite;
  assert.equal(c.gradedLegs, 1);
  assert.equal(c.allLegsWon, true, "the one graded leg (the parent) did win");
  assert.equal(c.chainResolved, false, "the most recent leg (the child) is still open");
  assert.equal(c.outcome, "open", "NOT 'win' — the child could still lose");
});

test("a WON parent + a WON child (both graded) → the chain is fully resolved and reports 'win'", () => {
  const root = 60;
  const rec = buildSwingRecord([
    leg({ id: root, roll_seq: 0, status: "ROLLED", realized_pnl_pct: 40 }),
    leg({ id: 61, root_position_id: root, parent_position_id: root, roll_seq: 1, status: "GRADED", realized_pnl_pct: 20 }),
  ]);
  const c = rec.composite;
  assert.equal(c.chainResolved, true);
  assert.equal(c.outcome, "win");
});

test("ungraded legs are not counted; a fully-open chain is 'open'", () => {
  const root = 30;
  const rec = buildSwingRecord([
    leg({ id: root, roll_seq: 0, status: "OPEN", realized_pnl_pct: null, graded_at: null }),
    leg({ id: 31, root_position_id: root, roll_seq: 1, status: "OPEN", realized_pnl_pct: null, graded_at: null }),
  ]);
  assert.equal(rec.composite.gradedLegs, 0);
  assert.equal(rec.composite.outcome, "open");
  assert.equal(rec.composite.allLegsWon, false);
  assert.equal(rec.composite.worstLegPnlPct, null);
});

test("a graded parent loss with an OPEN child is already a loss (loss preserved before the chain resolves)", () => {
  const root = 40;
  const rec = buildSwingRecord([
    leg({ id: root, roll_seq: 0, status: "ROLLED", realized_pnl_pct: -50 }),
    leg({ id: 41, root_position_id: root, roll_seq: 1, status: "OPEN", realized_pnl_pct: null, graded_at: null }),
  ]);
  assert.equal(rec.composite.gradedLegs, 1);
  assert.equal(rec.composite.outcome, "loss");
  assert.equal(rec.composite.worstLegPnlPct, -50);
});

test("low_n badges a thin chain", () => {
  const rec = buildSwingRecord([leg()]);
  assert.equal(rec.composite.low_n, 1 < LOW_N_THRESHOLD);
});

// ─── FIX (A): breakevens surfaced alongside wins/losses (docs/audit/findings-staging) ──────────────

test("buildSwingRecordSummary: an exact-0% chain counts as a loss (isSwingWin unchanged) AND is reported in `breakevens`", () => {
  // Live population this mirrors (2026-09-09 30-day /swing/record pull): a single-leg chain frozen via
  // roll-freeze markfreeze.v1 at exit_mark === entry_premium to the cent → realized_pnl_pct === 0.
  const breakevenChain = buildSwingRecord([leg({ id: 100, realized_pnl_pct: 0 })]);
  const realLossChain = buildSwingRecord([leg({ id: 101, realized_pnl_pct: -50 })]);
  const winChain = buildSwingRecord([leg({ id: 102, realized_pnl_pct: 30 })]);
  const openChain = buildSwingRecord([leg({ id: 103, realized_pnl_pct: null, graded_at: null, status: "OPEN" })]);

  const summary = buildSwingRecordSummary(
    [breakevenChain, realLossChain, winChain, openChain],
    { since: "2026-08-10", through: "2026-09-09", days: 30 },
  );

  // isSwingWin's binary semantics are UNCHANGED: the breakeven chain still counts as a full loss, exactly
  // like before this field existed — losses = {breakeven, realLoss} = 2, wins = {winChain} = 1.
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 2);
  assert.equal(summary.opens, 1);
  // NEW: of those 2 losses, exactly 1 is a breakeven (worstLegPnlPct === 0) — the real drawdown loss is
  // NOT counted here, so a reader can recover "1 real loss, 1 breakeven-as-loss" from these two fields.
  assert.equal(summary.breakevens, 1);
  assert.ok(summary.breakevens <= summary.losses, "breakevens is a subset of losses, never exceeds it");
});

test("buildSwingRecordSummary: no breakeven legs → breakevens is 0, not omitted/undefined", () => {
  const summary = buildSwingRecordSummary(
    [buildSwingRecord([leg({ realized_pnl_pct: 30 })]), buildSwingRecord([leg({ realized_pnl_pct: -20 })])],
    { since: "2026-08-10", through: "2026-09-09", days: 30 },
  );
  assert.equal(summary.breakevens, 0);
  assert.equal(summary.losses, 1);
});

// ─── Live-caught 2026-09-12: summary.breakevens must agree with what the API actually SERVES ───────
// route.ts wraps the whole response (summary + records) in roundFloats(..., 2) before it goes over
// the wire. Before the fix, `worstLegPnlPct` was carried at FULL float precision inside
// buildSwingRecord, and buildSwingRecordSummary's `breakevens` count tested that RAW value for an
// exact 0 — but the client never sees the raw value, only the roundFloats(2)'d one. A tiny genuine
// non-zero leg P&L (e.g. -0.001%, well within real float noise from a mark-freeze
// (mark-entry)/entry*100 computation) is NOT exactly 0 (so summary correctly excluded it from
// breakevens) but rounds to a displayed "0" (JSON.stringify(-0) is even literally "0") — so a
// member/Largo reading the payload could count MORE records showing worstLegPnlPct:0 than
// summary.breakevens reports. This reproduces the live discrepancy found on
// /api/market/swing/record 2026-09-12 (summary said breakevens:3, but 5 of 21 served records
// displayed worstLegPnlPct:0). The fix rounds worstLegPnlPct to 2dp AT SOURCE (in buildSwingRecord),
// so summary's exact-0 test and the served display always agree — a value that rounds to 0.00% is
// now consistently treated as a breakeven in BOTH the summary count and the served record.
test("served (post-roundFloats) worstLegPnlPct never shows 0 for a chain summary.breakevens excludes", () => {
  // Sub-cent noise (-0.001%) rounds to a served 0.00% — after the fix it is CONSISTENTLY treated as
  // a breakeven in both summary.breakevens and the served worstLegPnlPct (both use the same 2dp
  // value), unlike before the fix where summary saw the raw -0.001 (not a breakeven) while the
  // served, rounded record showed 0 (looked exactly like one).
  const subCentLossChain = buildSwingRecord([leg({ realized_pnl_pct: -0.001 })]);
  // A real, cent-scale loss must still NOT be miscounted as a breakeven or displayed as 0.
  const realLossChain = buildSwingRecord([leg({ realized_pnl_pct: -0.03 })]);

  const summary = buildSwingRecordSummary([subCentLossChain, realLossChain], {
    since: "2026-08-10",
    through: "2026-09-09",
    days: 30,
  });
  assert.equal(summary.losses, 2);
  assert.equal(summary.breakevens, 1); // only the sub-cent chain rounds to a served 0

  // Simulate the API boundary: same records + summary, wrapped in roundFloats(2) like route.ts does.
  const served = roundFloats({ summary, records: [subCentLossChain, realLossChain] });

  // The general-purpose regression guard: for EVERY served record, "worstLegPnlPct displays as 0"
  // must imply "summary.breakevens counted it" (the two views can never disagree on this point) —
  // this is the invariant that was broken live before the fix.
  const servedZeroCount = served.records.filter(
    (r: { composite: { outcome: string; worstLegPnlPct: number | null } }) =>
      r.composite.outcome === "loss" && r.composite.worstLegPnlPct === 0,
  ).length;
  assert.equal(
    servedZeroCount,
    served.summary.breakevens,
    "the number of SERVED records displaying worstLegPnlPct:0 must equal summary.breakevens exactly",
  );
  // And the real loss must never be swallowed into looking like a breakeven.
  assert.notEqual(served.records[1].composite.worstLegPnlPct, 0);
});

test("buildSwingRecordSummary: methodology text documents that a 0% leg counts as a loss in this view", () => {
  const summary = buildSwingRecordSummary([], { since: "2026-08-10", through: "2026-09-09", days: 30 });
  assert.match(summary.methodology, /0% .*(counts as a LOSS|breakeven)/i);
});
