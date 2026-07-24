import { test } from "node:test";
import assert from "node:assert/strict";
import { planManageSync, type ManageSyncReads } from "./manage-sync.ts";
import { runSwingActiveRefresh } from "./active-refresh.ts";
import type { SwingPositionRow, SwingSnapshotInsert } from "../db.ts";

function positionRow(over: Partial<SwingPositionRow> = {}): SwingPositionRow {
  return {
    id: 1,
    commit_key: "NVDA|LONG|2026-07-24",
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-07-24",
    ticker: "NVDA",
    direction: "long",
    sub_lane: "STANDARD",
    archetype: "BREAKOUT",
    top_flow_strike: null,
    contract_strike: 150,
    contract_expiry: "2026-08-14",
    contract_type: "call",
    contract_occ: "NVDA260814C00150000",
    contract_delta: 0.6,
    entry_underlying_px: 150,
    thesis_invalidation_px: 140, // LONG breaks at/below 140
    target_underlying_px: 170,
    entry_premium: 5,
    last_mark: 5,
    peak_premium: 5,
    trough_premium: 5,
    underlying_mfe: 150,
    underlying_mae: 150,
    realized_pnl_pct: null,
    entry_context: null,
    gate_calibration_json: null,
    feature_vector: null,
    plan_json: null,
    scale_out_grade: null,
    grade_json: null,
    grade_methodology: null,
    legacy_grade: null,
    status: "OPEN",
    first_seen_at: "2026-07-24T20:00:00.000Z",
    committed_at: "2026-07-24T20:00:00.000Z",
    closed_at: null,
    graded_at: null,
    updated_at: "2026-07-24T20:00:00.000Z",
    ...over,
  };
}

test("planManageSync: thesis intact → snapshot appended, status stays OPEN (never terminal)", () => {
  const reads: ManageSyncReads = { underlyingPrice: 152, dte: 21, underlyingMfe: 152, underlyingMae: 152 };
  const plan = planManageSync(positionRow(), reads, { snapshotKind: "eod" });
  assert.equal(plan.snapshot.snapshot_kind, "eod");
  assert.equal(plan.snapshot.position_id, 1);
  assert.equal(plan.snapshot.thesis_state, "INTACT");
  assert.equal(plan.liveState.status, "OPEN", "NEVER-CLOSE invariant: refresh keeps a live status");
  assert.notEqual(plan.liveState.status, "CLOSED");
});

test("planManageSync: capital-preservation gate (structural stop) is enforced but NOT auto-closed", () => {
  // Underlying 138 ≤ thesis invalidation 140 → LONG structural stop broken.
  const reads: ManageSyncReads = { underlyingPrice: 138, dte: 21 };
  const plan = planManageSync(positionRow(), reads, { snapshotKind: "eod" });
  assert.equal(plan.verdict.rung, "structural_stop");
  assert.equal(plan.verdict.enforced, true, "capital-preservation gate always enforces");
  assert.equal(plan.snapshot.thesis_state, "BROKEN");
  assert.equal((plan.snapshot.event_json as Record<string, unknown>).gating, true);
  // But PR-13 is HOLD/evidence-only — the mechanical close is PR-15; status must NOT go terminal here.
  assert.equal(plan.liveState.status, "OPEN");
});

test("planManageSync: edge rung stays evidence-only (enforced:false)", () => {
  const reads: ManageSyncReads = { underlyingPrice: 152, dte: 21, flowDecayed: true };
  const plan = planManageSync(positionRow(), reads, { snapshotKind: "eod" });
  assert.equal(plan.verdict.rung, "flow_decay");
  assert.equal(plan.verdict.enforced, false, "edge rungs are evidence-only until graduated");
  assert.equal(plan.snapshot.thesis_state, "WATCH");
});

test("runSwingActiveRefresh: APPEND-ONLY snapshots, live-state latched, NEVER commits/closes", async () => {
  const snapshots: SwingSnapshotInsert[] = [];
  const liveStates: Array<{ id: number; status: string }> = [];
  const res = await runSwingActiveRefresh({
    fetchOpen: async () => [positionRow({ id: 1 }), positionRow({ id: 2, ticker: "AMD" })],
    loadReads: async (row) => ({ underlyingPrice: 152, dte: 21, underlyingMfe: 152, underlyingMae: 152, sessionsHeld: row.id }),
    insertSnapshot: async (s) => { snapshots.push(s); return snapshots.length; },
    updateLiveState: async (id, s) => { liveStates.push({ id, status: s.status }); },
    snapshotKind: "eod",
  });

  assert.equal(res.positions, 2);
  assert.equal(res.refreshed, 2);
  assert.equal(res.snapshotsAppended, 2, "exactly one appended snapshot per position");
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots.map((s) => s.snapshot_kind), ["eod", "eod"]);
  // Never a terminal status write (no close/roll in PR-13).
  for (const ls of liveStates) assert.ok(!["CLOSED", "ROLLED"].includes(ls.status), "refresh never writes terminal status");
});

test("runSwingActiveRefresh: fail-soft — null reads skip, a snapshot error is isolated", async () => {
  const res = await runSwingActiveRefresh({
    fetchOpen: async () => [positionRow({ id: 1 }), positionRow({ id: 2 }), positionRow({ id: 3 })],
    loadReads: async (row) => (row.id === 2 ? null : { underlyingPrice: 152, dte: 21 }),
    insertSnapshot: async () => { throw new Error("db down"); },
    updateLiveState: async () => {},
    snapshotKind: "eod",
  });
  assert.equal(res.positions, 3);
  assert.equal(res.skipped, 1, "id=2 had null reads → skipped");
  assert.equal(res.errored, 2, "id=1 and id=3 hit the snapshot error, isolated (loop did not abort)");
  assert.equal(res.refreshed, 0);
});

test("runSwingActiveRefresh: whole-fetch failure degrades to an empty pass (never throws)", async () => {
  const res = await runSwingActiveRefresh({
    fetchOpen: async () => { throw new Error("db unreachable"); },
    loadReads: async () => ({ underlyingPrice: 1 }),
    insertSnapshot: async () => 1,
    updateLiveState: async () => {},
  });
  assert.deepEqual(res, { positions: 0, refreshed: 0, snapshotsAppended: 0, skipped: 0, errored: 0, outcomes: [] });
});
