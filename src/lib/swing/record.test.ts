import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSwingRecord,
  isSwingWin,
  LOW_N_THRESHOLD,
  type SwingLegRowLike,
} from "./record.ts";

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
  assert.equal(rec.composite.losses, 0);
  assert.equal(rec.composite.worstLegPnlPct, 30);
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
