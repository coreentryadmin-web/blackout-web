import { test } from "node:test";
import assert from "node:assert/strict";

// Everything under test is pure or an in-process singleton — no providers, no DB — so it
// imports directly (no module mocks). Reset the accumulators between the stateful cases.
import {
  buildInputAgeManifest,
  computeLatencyStats,
  percentile,
  originBucketKey,
  spanStageDurations,
  recordScanDuration,
  recordScanSpans,
  recordCommitLatency,
  recordCommittedRows,
  recordUngradeable,
  recordGradeVsAsManagedDeltaBps,
  snapshotZeroDteLatency,
  _resetZeroDteLatencyForTest,
} from "./latency-telemetry";

// ── WS-14 test (1): a commit's input_age_manifest has ALL keys, null where unknown ────
test("buildInputAgeManifest: all keys present, ages computed, null where the timestamp is unknown", () => {
  const now = Date.parse("2026-07-13T13:55:00Z");
  const m = buildInputAgeManifest(
    {
      flow_at: now - 4_000, // 4s-old freshest flow print
      underlying_at: now - 60_000, // 1m-old underlying minute bar
      // option_quote / gex / vix / macro / spy_bias unknown at this commit → null
    },
    now
  );
  // Every declared key is present (the manifest is never a partial object).
  assert.deepEqual(Object.keys(m).sort(), [
    "flow",
    "gex",
    "macro",
    "option_quote",
    "spy_bias",
    "underlying",
    "vix",
  ]);
  assert.equal(m.flow, 4_000);
  assert.equal(m.underlying, 60_000);
  // Genuinely-unknown inputs are honestly null — never fabricated.
  assert.equal(m.option_quote, null);
  assert.equal(m.gex, null);
  assert.equal(m.vix, null);
  assert.equal(m.macro, null);
  assert.equal(m.spy_bias, null);
});

test("buildInputAgeManifest: clock-skew future timestamp clamps to 0; non-finite → null", () => {
  const now = 1_000_000;
  const m = buildInputAgeManifest(
    { flow_at: now + 500, underlying_at: Number.NaN, gex_at: null },
    now
  );
  assert.equal(m.flow, 0); // future → clamped, never negative
  assert.equal(m.underlying, null); // NaN → null
  assert.equal(m.gex, null); // explicit null → null
  // A non-finite "now" makes every age unknowable.
  assert.equal(buildInputAgeManifest({ flow_at: 5 }, Number.NaN).flow, null);
});

// ── WS-14 test (2): percentiles compute correctly from a synthetic span set ───────────
test("percentile + computeLatencyStats: nearest-rank p50/p95/p99 over a synthetic set", () => {
  // 1..100 → nearest-rank: p50 = ceil(0.50*100)=50th value = 50, p95 = 95, p99 = 99.
  const samples = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(samples, 50), 50);
  assert.equal(percentile(samples, 95), 95);
  assert.equal(percentile(samples, 99), 99);
  assert.equal(percentile(samples, 100), 100);
  // Empty set → 0 (matches api-telemetry's convention).
  assert.equal(percentile([], 95), 0);
  // Non-finite samples are filtered out before ranking.
  assert.equal(percentile([Number.NaN, 10, 20, 30], 50), 20);

  const stats = computeLatencyStats(samples);
  assert.deepEqual(stats, { count: 100, p50_ms: 50, p95_ms: 95, p99_ms: 99 });
  assert.deepEqual(computeLatencyStats([]), { count: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0 });
});

test("spanStageDurations: adjacent-hop deltas, null endpoints → null, no negative durations", () => {
  const d = spanStageDurations({
    scan_started_at: 1_000,
    candidate_derived_at: 1_200,
    chain_received_at: 1_900,
    gates_completed_at: 3_400,
    cortex_completed_at: 3_400,
    committed_at: 3_600,
    board_visible_at: null, // not knowable in the scan → total falls back to committed_at
  });
  assert.equal(d.derive_ms, 200);
  assert.equal(d.chain_ms, 700);
  assert.equal(d.gates_ms, 1_500);
  assert.equal(d.cortex_ms, 0);
  assert.equal(d.commit_ms, 200);
  assert.equal(d.visible_ms, null); // board_visible_at null
  assert.equal(d.total_ms, 2_600); // scan_started → committed
  // A backwards pair (clock skew) is null, never a negative duration.
  assert.equal(
    spanStageDurations({
      scan_started_at: 5_000,
      candidate_derived_at: 4_000,
      chain_received_at: null,
      gates_completed_at: null,
      cortex_completed_at: null,
      committed_at: null,
      board_visible_at: null,
    }).derive_ms,
    null
  );
});

test("originBucketKey: sorted set key; empty/nullish → UNKNOWN", () => {
  assert.equal(originBucketKey(["FLOW"]), "FLOW");
  assert.equal(originBucketKey(["FLOW", "BREAKOUT"]), "BREAKOUT+FLOW");
  assert.equal(originBucketKey(["BREAKOUT", "FLOW"]), "BREAKOUT+FLOW"); // order-independent
  assert.equal(originBucketKey([]), "UNKNOWN");
  assert.equal(originBucketKey(null), "UNKNOWN");
});

// ── WS-15 test (3): scan-duration + committed-write + ungradeable-rate metrics compute ─
test("snapshotZeroDteLatency: scan duration, committed rows, ungradeable rate, per-origin latency", () => {
  _resetZeroDteLatencyForTest();

  // Scan-duration samples: 10,20,...,100 → p50=50 (nearest-rank 5th of 10), p95/p99=100.
  for (let i = 1; i <= 10; i++) recordScanDuration(i * 10);

  // Stage spans (one pass) → derive/chain/gates/total buffers get one sample each.
  recordScanSpans({
    scan_started_at: 0,
    candidate_derived_at: 100,
    chain_received_at: 400,
    gates_completed_at: 900,
    cortex_completed_at: 900,
    committed_at: 1_100,
    board_visible_at: null,
  });

  // Per-origin end-to-end commit latency.
  recordCommitLatency(["FLOW"], 3_000);
  recordCommitLatency(["FLOW"], 5_000);
  recordCommitLatency(["BREAKOUT", "FLOW"], 8_000);

  // WS-15 committed-row counter + ungradeable count for one session.
  recordCommittedRows("2026-07-13", 4);
  recordUngradeable("2026-07-13");

  const snap = snapshotZeroDteLatency();

  assert.equal(snap.scan_duration.count, 10);
  assert.equal(snap.scan_duration.p50_ms, 50);
  assert.equal(snap.scan_duration.p95_ms, 100);
  assert.equal(snap.scan_duration.p99_ms, 100);

  assert.equal(snap.stages.derive.count, 1);
  assert.equal(snap.stages.derive.p95_ms, 100);
  assert.equal(snap.stages.chain.p95_ms, 300);
  assert.equal(snap.stages.gates.p95_ms, 500);
  assert.equal(snap.stages.total.p95_ms, 1_100);

  const flow = snap.commit_latency_by_origin.find((o) => o.origin === "FLOW");
  const combo = snap.commit_latency_by_origin.find((o) => o.origin === "BREAKOUT+FLOW");
  assert.ok(flow && combo);
  assert.equal(flow!.count, 2);
  assert.equal(flow!.p50_ms, 3_000); // nearest-rank p50 of [3000,5000] = 1st = 3000
  assert.equal(flow!.p95_ms, 5_000);
  assert.equal(combo!.count, 1);
  assert.equal(combo!.p95_ms, 8_000);

  assert.equal(snap.committed_by_session.length, 1);
  const sess = snap.committed_by_session[0]!;
  assert.equal(sess.session_date, "2026-07-13");
  assert.equal(sess.committed_rows, 4);
  assert.equal(sess.ungradeable, 1);
  assert.equal(sess.ungradeable_rate, 0.25); // 1/4

  // A date with zero committed rows reports a null rate (honest "no data", never fake 0%).
  recordUngradeable("2026-07-14");
  const snap2 = snapshotZeroDteLatency();
  const orphan = snap2.committed_by_session.find((s) => s.session_date === "2026-07-14");
  assert.ok(orphan);
  assert.equal(orphan!.committed_rows, 0);
  assert.equal(orphan!.ungradeable_rate, null);

  _resetZeroDteLatencyForTest();
  const cleared = snapshotZeroDteLatency();
  assert.equal(cleared.scan_duration.count, 0);
  assert.equal(cleared.committed_by_session.length, 0);
});

// ── WS-11: grade_vs_asmanaged_delta histogram (reconciliation guard, ≈0) ────────────────
test("recordGradeVsAsManagedDeltaBps: abs-value samples; null/non-finite skipped; ≈0 after reconciliation", () => {
  _resetZeroDteLatencyForTest();
  recordGradeVsAsManagedDeltaBps(0); // the reconciled case
  recordGradeVsAsManagedDeltaBps(-30); // a two-sided divergence still surfaces via |·|
  recordGradeVsAsManagedDeltaBps(50);
  recordGradeVsAsManagedDeltaBps(null); // skipped
  recordGradeVsAsManagedDeltaBps(Number.NaN); // skipped
  const snap = snapshotZeroDteLatency();
  assert.equal(snap.grade_vs_asmanaged_delta_bps.count, 3);
  assert.equal(snap.grade_vs_asmanaged_delta_bps.p50_ms, 30); // |−30| ranked in
  assert.equal(snap.grade_vs_asmanaged_delta_bps.p95_ms, 50);
  _resetZeroDteLatencyForTest();
  assert.equal(snapshotZeroDteLatency().grade_vs_asmanaged_delta_bps.count, 0);
});
