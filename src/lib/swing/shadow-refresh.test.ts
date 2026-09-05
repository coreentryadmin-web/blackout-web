import test from "node:test";
import assert from "node:assert/strict";
import type { SwingShadowPositionRow } from "@/lib/db";
import {
  decideShadowClose,
  runSwingShadowRefresh,
  shadowIntrinsicMarkAtExpiry,
  shadowPremiumStopHit,
  shadowRealizedPnlPct,
  shadowStructuralStopBroken,
} from "./shadow-refresh.js";

function shadowRow(overrides: Partial<SwingShadowPositionRow> = {}): SwingShadowPositionRow {
  return {
    id: 1,
    commit_key: "k",
    session_date: "2026-09-05",
    ticker: "AAPL",
    direction: "long",
    sub_lane: "STANDARD",
    archetype: "MOMENTUM",
    contract_strike: 200,
    contract_expiry: "2026-10-17",
    contract_type: "call",
    contract_occ: "AAPL251017C00200000",
    contract_delta: 0.35,
    entry_underlying_px: 198,
    thesis_invalidation_px: 190,
    target_underlying_px: 220,
    entry_premium: 5,
    blocked_by: ["budget:per_position_loss"],
    entry_context: null,
    gate_calibration_json: null,
    feature_vector: null,
    last_mark: 4.5,
    last_mark_at: null,
    peak_premium: 5.2,
    trough_premium: 4.2,
    realized_pnl_pct: null,
    status: "OPEN",
    first_seen_at: "2026-09-05T14:00:00.000Z",
    closed_at: null,
    graded_at: null,
    updated_at: "2026-09-05T14:00:00.000Z",
    ...overrides,
  };
}

test("shadowRealizedPnlPct matches roll-plan convention", () => {
  assert.equal(shadowRealizedPnlPct(5, 6), 20);
  assert.equal(shadowRealizedPnlPct(5, 3), -40);
});

test("shadowStructuralStopBroken fires for LONG below stop", () => {
  const hit = shadowStructuralStopBroken("long", 189, 190);
  assert.equal(hit.broken, true);
});

test("shadowPremiumStopHit fires at −60% backstop", () => {
  assert.equal(shadowPremiumStopHit(5, 2).hit, true);
  assert.equal(shadowPremiumStopHit(5, 2.1).hit, false);
});

test("decideShadowClose prioritizes expiry over premium stop", () => {
  const decision = decideShadowClose(shadowRow(), {
    underlyingPrice: 200,
    mark: 1,
    dte: -1,
    nowMs: Date.now(),
  });
  assert.equal(decision.reason, "expiry");
});

test("shadowIntrinsicMarkAtExpiry uses OTM intrinsic zero for expired long call", () => {
  assert.equal(
    shadowIntrinsicMarkAtExpiry(shadowRow({ contract_type: "call", contract_strike: 200 }), 180),
    0,
  );
  assert.equal(
    shadowIntrinsicMarkAtExpiry(shadowRow({ contract_type: "call", contract_strike: 200 }), 210),
    10,
  );
  assert.equal(
    shadowIntrinsicMarkAtExpiry(shadowRow({ contract_type: "put", contract_strike: 200 }), 190),
    10,
  );
});

test("runSwingShadowRefresh closes expiry at intrinsic not stale last mark", async () => {
  let gradedExit = 0;
  const res = await runSwingShadowRefresh({
    fetchOpen: async () => [shadowRow({ id: 9, entry_premium: 5, last_mark: 4.5 })],
    loadReads: async () => ({
      underlyingPrice: 180,
      mark: 4.5,
      dte: -1,
      nowMs: Date.now(),
    }),
    updateMarks: async () => 1,
    closeAndGrade: async (_id, g) => {
      gradedExit = g.realized_pnl_pct;
      assert.equal(g.close_reason, "expiry");
      return 1;
    },
  });
  assert.equal(res.closed, 1);
  assert.equal(gradedExit, -100);
});

test("decideShadowClose closes on structural stop", () => {
  const decision = decideShadowClose(shadowRow(), {
    underlyingPrice: 188,
    mark: 4,
    dte: 10,
    nowMs: Date.now(),
  });
  assert.equal(decision.reason, "structural_stop");
});

test("runSwingShadowRefresh marks and closes fail-soft per row", async () => {
  const marks: number[] = [];
  const closed: number[] = [];
  const res = await runSwingShadowRefresh({
    fetchOpen: async () => [shadowRow({ id: 7 })],
    loadReads: async () => ({
      underlyingPrice: 188,
      mark: 2,
      dte: 10,
      nowMs: Date.now(),
    }),
    updateMarks: async (id, u) => {
      marks.push(u.mark);
      return 1;
    },
    closeAndGrade: async (id, g) => {
      closed.push(id);
      assert.equal(g.close_reason, "structural_stop");
      return 1;
    },
  });
  assert.equal(res.marked, 1);
  assert.equal(res.closed, 1);
  assert.deepEqual(marks, [2]);
  assert.deepEqual(closed, [7]);
});
