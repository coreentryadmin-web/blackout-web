import { test } from "node:test";
import assert from "node:assert/strict";
import {
  swingLabel,
  summarizeSwingFeatureStore,
  studyTwoStagnantSessions,
  studyFlowDecay,
  studyIvKillsGoodSetups,
  analyzeBestDteByArchetype,
  loadSwingTrajectoryStudies,
  MIN_SAMPLES,
  type SwingFeatureRowLike,
  type SwingSnapshotLike,
} from "./feature-store.ts";

let idSeq = 1;
function row(overrides: Partial<SwingFeatureRowLike> = {}): SwingFeatureRowLike {
  return {
    id: idSeq++,
    ticker: "NVDA",
    direction: "long",
    archetype: "BREAKOUT",
    sub_lane: "STANDARD",
    session_date: "2026-07-20",
    realized_pnl_pct: 100,
    graded_at: "2026-07-25T00:00:00.000Z",
    feature_vector: { evidence_score: 78 },
    ...overrides,
  };
}
function snap(overrides: Partial<SwingSnapshotLike> = {}): SwingSnapshotLike {
  return {
    position_id: 0,
    snapshot_kind: "eod",
    dte_remaining: 14,
    running_mfe: 0,
    running_mae: 0,
    option_mark: null,
    underlying_px: 100,
    thesis_state: "intact",
    feature_vector: {},
    created_at: "2026-07-20T20:00:00.000Z",
    ...overrides,
  };
}

// ── label: graded evidence only, win = pnl>0 ─────────────────────────────────────
test("swingLabel: graded+pnl>0 → win; ≤0 → loss; ungraded/no-pnl → null (never coerced)", () => {
  assert.equal(swingLabel({ graded_at: "x", realized_pnl_pct: 40 }), "win");
  assert.equal(swingLabel({ graded_at: "x", realized_pnl_pct: -50 }), "loss");
  assert.equal(swingLabel({ graded_at: "x", realized_pnl_pct: 0 }), "loss"); // 0 is not >0
  assert.equal(swingLabel({ graded_at: null, realized_pnl_pct: 40 }), null); // not graded → not evidence
  assert.equal(swingLabel({ graded_at: "x", realized_pnl_pct: null }), null);
});

// ── honest-null base rates under MIN_SAMPLES ─────────────────────────────────────
test("base rate is null below MIN_SAMPLES (honest-null), a real number at/above it", () => {
  const few = summarizeSwingFeatureStore(Array.from({ length: MIN_SAMPLES - 1 }, () => row()));
  assert.equal(few.overall.n, MIN_SAMPLES - 1);
  assert.equal(few.overall.wins, MIN_SAMPLES - 1);
  assert.equal(few.overall.winRate, null); // thin cut cannot masquerade as a rate

  // MIN_SAMPLES rows, all wins → winRate seals to 1.
  const enough = summarizeSwingFeatureStore(Array.from({ length: MIN_SAMPLES }, () => row()));
  assert.equal(enough.overall.n, MIN_SAMPLES);
  assert.equal(enough.overall.winRate, 1);
});

test("ungraded rows are dropped, never counted as losses", () => {
  const rows = [row(), row({ graded_at: null }), row({ realized_pnl_pct: null })];
  const s = summarizeSwingFeatureStore(rows);
  assert.equal(s.gradedRows, 1);
  assert.equal(s.droppedRows, 2);
  assert.equal(s.overall.n, 1);
});

// ── trajectory study joins the snapshot series to the outcome ─────────────────────
test("studyTwoStagnantSessions joins the snapshot series to the graded outcome", () => {
  // Stalled position (LOSS): 4 EOD snaps whose running MFE never advances → ≥2 stagnant sessions.
  const stalled = row({ id: 501, realized_pnl_pct: -50 });
  const stalledSnaps = [
    snap({ position_id: 501, running_mfe: 3 }),
    snap({ position_id: 501, running_mfe: 3 }), // stagnant #1
    snap({ position_id: 501, running_mfe: 2.5 }), // stagnant #2
    snap({ position_id: 501, running_mfe: 2.5 }), // stagnant #3
  ];
  // Advancing position (WIN): MFE makes new highs every session → 0 stagnant.
  const advancing = row({ id: 502, realized_pnl_pct: 120 });
  const advancingSnaps = [
    snap({ position_id: 502, running_mfe: 2 }),
    snap({ position_id: 502, running_mfe: 5 }),
    snap({ position_id: 502, running_mfe: 9 }),
    snap({ position_id: 502, running_mfe: 14 }),
  ];
  const byId: Record<number, SwingSnapshotLike[]> = { 501: stalledSnaps, 502: advancingSnaps };

  const study = studyTwoStagnantSessions([stalled, advancing], (id) => byId[id] ?? []);
  // The stalled loser lands in withSignal; the advancing winner in withoutSignal — the join is correct.
  assert.equal(study.withSignal.n, 1);
  assert.equal(study.withSignal.wins, 0); // the stalled thesis lost
  assert.equal(study.withoutSignal.n, 1);
  assert.equal(study.withoutSignal.wins, 1); // the advancing thesis won
  assert.equal(study.skipped, 0);
});

test("studyTwoStagnantSessions skips positions with too few EOD snapshots (no fabricated side)", () => {
  const r = row({ id: 601 });
  const study = studyTwoStagnantSessions([r], () => [
    snap({ position_id: 601, running_mfe: 1 }),
    snap({ position_id: 601, running_mfe: 2 }),
  ]);
  assert.equal(study.skipped, 1);
  assert.equal(study.withSignal.n, 0);
  assert.equal(study.withoutSignal.n, 0);
});

test("studyFlowDecay joins pinned pil_flow decay to outcome", () => {
  const decayed = row({ id: 701, realized_pnl_pct: -50 });
  const decaySnaps = [
    snap({ position_id: 701, feature_vector: { pil_flow: 0.8 } }),
    snap({ position_id: 701, feature_vector: { pil_flow: 0.5 } }),
    snap({ position_id: 701, feature_vector: { pil_flow: 0.3 } }), // decayed ≥0.10
  ];
  const held = row({ id: 702, realized_pnl_pct: 90 });
  const heldSnaps = [
    snap({ position_id: 702, feature_vector: { pil_flow: 0.6 } }),
    snap({ position_id: 702, feature_vector: { pil_flow: 0.65 } }),
  ];
  const byId: Record<number, SwingSnapshotLike[]> = { 701: decaySnaps, 702: heldSnaps };
  const study = studyFlowDecay([decayed, held], (id) => byId[id] ?? []);
  assert.equal(study.withSignal.n, 1);
  assert.equal(study.withSignal.wins, 0);
  assert.equal(study.withoutSignal.n, 1);
  assert.equal(study.withoutSignal.wins, 1);
});

test("studyIvKillsGoodSetups: high-evidence + option crushed while underlying held → signal", () => {
  const ivKilled = row({ id: 801, realized_pnl_pct: -40, feature_vector: { evidence_score: 82 } });
  const ivSnaps = [
    snap({ position_id: 801, option_mark: 5.0, running_mae: -0.5 }),
    snap({ position_id: 801, option_mark: 3.4, running_mae: -1.5 }), // -32% option, underlying held (-1.5%)
  ];
  const study = studyIvKillsGoodSetups([ivKilled], (id) => (id === 801 ? ivSnaps : []));
  assert.equal(study.withSignal.n, 1);
  assert.equal(study.withSignal.wins, 0);
});

// ── best DTE per archetype: honest-null until a sub-lane bucket seals ─────────────
test("analyzeBestDteByArchetype: best null until a sub-lane bucket clears MIN_SAMPLES", () => {
  const rows = [
    ...Array.from({ length: 5 }, () => row({ archetype: "BREAKOUT", sub_lane: "TACTICAL" })),
    ...Array.from({ length: MIN_SAMPLES }, () =>
      row({ archetype: "BREAKOUT", sub_lane: "STANDARD", realized_pnl_pct: 100 })
    ),
  ];
  const out = analyzeBestDteByArchetype(rows);
  assert.equal(out.BREAKOUT.bySubLane.TACTICAL!.winRate, null); // thin → provisional
  assert.equal(out.BREAKOUT.bySubLane.STANDARD!.winRate, 1); // sealed
  assert.deepEqual(out.BREAKOUT.best, { subLane: "STANDARD", winRate: 1 });
  assert.equal(out.MEAN_REVERSION.best, null); // no evidence at all
});

// ── deps-injected orchestrator needs no live DB ──────────────────────────────────
test("loadSwingTrajectoryStudies wires injected fake accessors (no live DB)", async () => {
  const rows = [row({ id: 901, realized_pnl_pct: -50 })];
  const snaps: SwingSnapshotLike[] = [
    snap({ position_id: 901, running_mfe: 4 }),
    snap({ position_id: 901, running_mfe: 4 }),
    snap({ position_id: 901, running_mfe: 4 }),
  ];
  const out = await loadSwingTrajectoryStudies({
    fetchGradedRows: async () => rows,
    fetchSnapshots: async (id) => (id === 901 ? snaps : []),
  });
  assert.equal(out.summary.gradedRows, 1);
  assert.equal(out.twoStagnantSessions.withSignal.n, 1); // stalled series joined to the loss
});
