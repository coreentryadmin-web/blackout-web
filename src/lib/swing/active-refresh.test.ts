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

// ── FIX 3: running_mfe/running_mae are SIGNED excursion % vs entry, NOT raw spot ──────────────────────────
test("planManageSync: running_mfe/mae are signed excursion % vs entry (not raw spot)", () => {
  // LONG entry 150, spot 156, extremes seeded at entry → MFE +4%, MAE 0% (never traded below entry).
  const plan = planManageSync(
    positionRow({ entry_underlying_px: 150, underlying_mfe: 150, underlying_mae: 150 }),
    { underlyingPrice: 156, dte: 20, underlyingMfe: 156, underlyingMae: 156 },
    { snapshotKind: "eod" },
  );
  assert.ok(Math.abs((plan.snapshot.running_mfe ?? NaN) - 4) < 1e-6, "MFE = (156-150)/150*100 = 4%");
  assert.equal(plan.snapshot.running_mae, 0, "MAE seeded at entry → 0% (price never dipped below entry)");
  assert.notEqual(plan.snapshot.running_mfe, 156, "must NOT be the raw spot price");
});

test("planManageSync: MFE/MAE read the ratcheted ledger PRICE extremes (favorable + adverse excursion)", () => {
  // LONG entry 150, ratcheted high-water 158 / low-water 141, spot 148 → MFE +5.33%, MAE −6%.
  const plan = planManageSync(
    positionRow({ entry_underlying_px: 150, underlying_mfe: 158, underlying_mae: 141 }),
    { underlyingPrice: 148, dte: 20 },
    { snapshotKind: "eod" },
  );
  assert.equal(plan.snapshot.running_mfe, 5.3333, "MFE from ratcheted high-water 158, rounded to 4dp");
  assert.equal(plan.snapshot.running_mae, -6, "MAE from ratcheted low-water 141");
});

test("planManageSync: SHORT excursion is sign-flipped (favorable = price falling)", () => {
  // SHORT entry 100, extremes 106/94, spot 95 → MFE = (100-94)/100 = +6%; MAE = (100-106)/100 = −6%.
  const plan = planManageSync(
    positionRow({ direction: "short", entry_underlying_px: 100, underlying_mfe: 106, underlying_mae: 94, thesis_invalidation_px: 110 }),
    { underlyingPrice: 95, dte: 20 },
    { snapshotKind: "eod" },
  );
  assert.ok(Math.abs((plan.snapshot.running_mfe ?? NaN) - 6) < 1e-6);
  assert.ok(Math.abs((plan.snapshot.running_mae ?? NaN) - -6) < 1e-6);
});

test("planManageSync: excursion is honest-null when entry price is missing (never fabricated)", () => {
  const plan = planManageSync(positionRow({ entry_underlying_px: null }), { underlyingPrice: 156, dte: 20 }, { snapshotKind: "eod" });
  assert.equal(plan.snapshot.running_mfe, null);
  assert.equal(plan.snapshot.running_mae, null);
});

// ── FIX 2: every snapshot carries a populated feature_vector (was always null → studies permanently empty) ──
test("planManageSync: snapshot carries a populated feature_vector (dynamic reads + pinned static)", () => {
  const pinned = { pil_flow: 0.62, evidence_score: 78, iv_rank: 44, present_pillars: 5 };
  const plan = planManageSync(
    positionRow({
      archetype: "BREAKOUT", sub_lane: "STANDARD", entry_premium: 4, feature_vector: pinned,
      entry_underlying_px: 150, underlying_mfe: 150, underlying_mae: 150,
    }),
    { underlyingPrice: 156, dte: 20, mark: 6, sessionsHeld: 2 },
    { snapshotKind: "eod" },
  );
  const fv = plan.snapshot.feature_vector as Record<string, unknown> | null;
  assert.ok(fv, "feature_vector is populated (was structurally always null before this fix)");
  assert.equal(fv!.v, 1);
  assert.equal(fv!.archetype, "BREAKOUT");
  assert.equal(fv!.sub_lane, "STANDARD");
  assert.equal(fv!.side, "long");
  // dynamic longitudinal part
  assert.equal(fv!.dte_remaining, 20);
  assert.equal(fv!.option_mark, 6);
  assert.equal(fv!.option_return_pct, 50); // (6/4 − 1) × 100
  assert.ok(Math.abs((fv!.running_mfe as number) - 4) < 1e-6, "running_mfe is the signed excursion %");
  assert.equal(fv!.thesis_state, "INTACT");
  assert.equal(fv!.snapshot_kind, "eod");
  // pinned static echoed so the trajectory studies have data (studyFlowDecay=pil_flow, studyIvKills=evidence)
  assert.equal(fv!.pil_flow, 0.62);
  assert.equal(fv!.evidence_score, 78);
  assert.equal(fv!.iv_rank, 44);
});

test("planManageSync: feature_vector is null-safe when the pinned vector + marks are absent", () => {
  const plan = planManageSync(
    positionRow({ feature_vector: null, entry_premium: null }),
    { underlyingPrice: 156, dte: 20 },
    { snapshotKind: "eod" },
  );
  const fv = plan.snapshot.feature_vector as Record<string, unknown> | null;
  assert.ok(fv);
  assert.equal(fv!.pil_flow, null, "absent pinned pillar → null, never a fabricated 0");
  assert.equal(fv!.evidence_score, null);
  assert.equal(fv!.iv_rank, null);
  assert.equal(fv!.option_mark, null, "no mark supplied → null");
  assert.equal(fv!.option_return_pct, null);
});

test("planManageSync: a fresh-resolved ivRank read wins over the commit-pinned value", () => {
  const plan = planManageSync(
    positionRow({ feature_vector: { iv_rank: 20 } }),
    { underlyingPrice: 156, dte: 20, ivRank: 61 },
    { snapshotKind: "eod" },
  );
  assert.equal((plan.snapshot.feature_vector as Record<string, unknown>).iv_rank, 61);
});

// ── FIX 4: an option mark loaded per-position lands on the snapshot + feature vector ───────────────────────
test("runSwingActiveRefresh: an option mark from loadReads lands on the snapshot + feature vector", async () => {
  const snapshots: SwingSnapshotInsert[] = [];
  await runSwingActiveRefresh({
    fetchOpen: async () => [positionRow({ id: 1, entry_premium: 4 })],
    // Simulates the route's loadReads AFTER loadOptionMark resolved the held contract's live mark.
    loadReads: async () => ({ underlyingPrice: 156, dte: 20, mark: 6, underlyingMfe: 156, underlyingMae: 156 }),
    insertSnapshot: async (s) => { snapshots.push(s); return snapshots.length; },
    updateLiveState: async () => {},
    snapshotKind: "eod",
  });
  assert.equal(snapshots[0]!.option_mark, 6, "the loaded contract mark lands on the snapshot");
  const fv = snapshots[0]!.feature_vector as Record<string, unknown>;
  assert.equal(fv.option_mark, 6, "premium-based management now has a real mark to evaluate");
  assert.equal(fv.option_return_pct, 50);
});
