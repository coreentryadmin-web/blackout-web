import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryStageSnapshotRows, type MultiSourceCandidateRow, type DiscoveryStageExtras } from "./candidates";

// Night Hawk Legacy Signal Intelligence, Phase 1.3: proves buildDiscoveryStageSnapshotRows (the
// pure row-builder recordDiscoveryStageSnapshots calls before the actual DB write) produces the
// right stage/rank/rejection_reason/payload shape for every STAGE-2 candidate, admitted or not.
//
// Deliberately does NOT drive this through the full extractMultiSourceCandidates integration with
// a mocked "@/lib/db" -- that's not viable in this repo's test environment. candidates.ts's
// dependency graph transitively pulls in flow-streak.ts, which imports "@/lib/db" via the alias
// form, and once ANY mock.module() call is active in a test process, tsx stops resolving the "@/"
// alias across the WHOLE loaded graph, not just the mocked specifier (documented in FINDINGS.md's
// thermalCompareForLargo entry, same tsx resolver-hook class as #2073: "anything that needs
// testing behind an aliased dynamic import has to extract the pure part"). This suite tests that
// extracted pure part directly instead -- no DB, no mock.module, no alias resolution involved.

function row(overrides: Partial<MultiSourceCandidateRow>): MultiSourceCandidateRow {
  return {
    ticker: "TEST",
    composite_score: 10,
    source_count: 1,
    sources: ["flow"],
    lane_scores: { flow: 10 },
    ...overrides,
  };
}

function extrasFor(rows: MultiSourceCandidateRow[]): DiscoveryStageExtras {
  const m: DiscoveryStageExtras = new Map();
  for (const r of rows) {
    m.set(r.ticker, {
      raw_composite_score: r.composite_score,
      streak_days: 0,
      streak_multiplier: 1,
      unusualness: null,
    });
  }
  return m;
}

test("buildDiscoveryStageSnapshotRows: every candidate in the pool gets exactly one 'discovery' row", () => {
  const rows = [row({ ticker: "NVDA", composite_score: 90 }), row({ ticker: "AMD", composite_score: 80 })];
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, rows, extrasFor(rows));

  const discovery = out.filter((r) => r.stage === "discovery");
  assert.equal(discovery.length, 2);
  assert.deepEqual(
    discovery.map((r) => r.ticker).sort(),
    ["AMD", "NVDA"]
  );
});

test("buildDiscoveryStageSnapshotRows: a candidate NOT in selectedRows also gets a 'rejected' row with reason 'confluence_gate'", () => {
  const rows = [row({ ticker: "NVDA", composite_score: 90 }), row({ ticker: "AXTI", composite_score: 10 })];
  const selected = [rows[0]!]; // AXTI dropped by the confluence gate
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, selected, extrasFor(rows));

  const rejected = out.filter((r) => r.stage === "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]!.ticker, "AXTI");
  assert.equal(rejected[0]!.rejection_reason, "confluence_gate");
  assert.equal(rejected[0]!.selected_for_publish, false);

  // NVDA (admitted) must NOT also get a rejected row.
  assert.equal(out.filter((r) => r.ticker === "NVDA" && r.stage === "rejected").length, 0);
});

test("buildDiscoveryStageSnapshotRows: an admitted candidate's discovery row carries selected_for_publish=null, not a premature decision", () => {
  const rows = [row({ ticker: "NVDA", composite_score: 90 })];
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, rows, extrasFor(rows));

  const discovery = out.find((r) => r.ticker === "NVDA" && r.stage === "discovery");
  assert.equal(
    discovery?.selected_for_publish,
    null,
    "discovery-stage rows never assert the FINAL publish decision -- that's STAGE 7's job, not STAGE 2's"
  );
});

test("buildDiscoveryStageSnapshotRows: rank is the 1-based position in the (caller-sorted) rows array", () => {
  const rows = [
    row({ ticker: "NVDA", composite_score: 90 }),
    row({ ticker: "AMD", composite_score: 70 }),
    row({ ticker: "TSLA", composite_score: 50 }),
  ];
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, rows, extrasFor(rows));

  const discovery = out.filter((r) => r.stage === "discovery");
  assert.equal(discovery.find((r) => r.ticker === "NVDA")?.rank, 1);
  assert.equal(discovery.find((r) => r.ticker === "AMD")?.rank, 2);
  assert.equal(discovery.find((r) => r.ticker === "TSLA")?.rank, 3);
});

test("buildDiscoveryStageSnapshotRows: rejected rows carry the SAME rank as their discovery row -- one candidate, two facets of the same stage", () => {
  const rows = [row({ ticker: "NVDA", composite_score: 90 }), row({ ticker: "AXTI", composite_score: 10 })];
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, [rows[0]!], extrasFor(rows));

  const axtiDiscovery = out.find((r) => r.ticker === "AXTI" && r.stage === "discovery");
  const axtiRejected = out.find((r) => r.ticker === "AXTI" && r.stage === "rejected");
  assert.equal(axtiDiscovery?.rank, axtiRejected?.rank);
  assert.equal(axtiDiscovery?.rank, 2);
});

test("buildDiscoveryStageSnapshotRows: the snapshot_json payload preserves raw inputs -- raw composite score, lane scores, streak, and unusualness block, all distinctly", () => {
  const rows = [row({ ticker: "NVDA", composite_score: 103.5, source_count: 3, sources: ["flow", "catalyst", "movers"], lane_scores: { flow: 28, catalyst: 12, movers: 5 } })];
  const extras: DiscoveryStageExtras = new Map([
    [
      "NVDA",
      {
        raw_composite_score: 90,
        streak_days: 4,
        streak_multiplier: 1.4,
        unusualness: {
          normalized_flow_lane_points: 28,
          raw_flow_premium_dollars: 5_000_000,
          baseline_avg_daily_premium_dollars: 500_000,
          baseline_floored_dollars: 500_000,
          production_ratio_lane_points_over_dollars: 28 / 500_000,
          production_multiplier_applied: 0.5,
        },
      },
    ],
  ]);
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, rows, extras);
  const payload = out[0]!.snapshot_json;

  assert.equal(payload.schema_version, 1);
  assert.equal(payload.composite_score, 103.5, "the FINAL (post streak/unusualness) score");
  assert.equal(payload.raw_composite_score, 90, "the RAW (pre streak/unusualness) score -- distinctly preserved");
  assert.equal(payload.source_count, 3);
  assert.deepEqual(payload.sources, ["flow", "catalyst", "movers"]);
  assert.deepEqual(payload.lane_scores, { flow: 28, catalyst: 12, movers: 5 });
  assert.equal(payload.streak_days, 4);
  assert.equal(payload.streak_multiplier, 1.4);

  const unusualness = payload.unusualness as Record<string, unknown>;
  assert.equal(unusualness.normalized_flow_lane_points, 28);
  assert.equal(unusualness.raw_flow_premium_dollars, 5_000_000);
  assert.notEqual(
    unusualness.normalized_flow_lane_points,
    unusualness.raw_flow_premium_dollars,
    "the normalized lane-point value and the real raw dollar value must never be conflated"
  );
});

test("buildDiscoveryStageSnapshotRows: a candidate with no unusualness data (flow lane never fired) captures null, not a fabricated zero", () => {
  const rows = [row({ ticker: "MOVERONLY", source_count: 1, sources: ["movers"], lane_scores: { movers: 5 } })];
  const extras: DiscoveryStageExtras = new Map([
    ["MOVERONLY", { raw_composite_score: 5, streak_days: 0, streak_multiplier: 1, unusualness: null }],
  ]);
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, rows, extras);
  assert.equal(out[0]!.snapshot_json.unusualness, null);
});

test("buildDiscoveryStageSnapshotRows: an empty pool produces an empty result, never a spurious row", () => {
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", [], [], new Map());
  assert.deepEqual(out, []);
});

test("buildDiscoveryStageSnapshotRows: edition_for is stamped identically on every row it produces", () => {
  const rows = [row({ ticker: "NVDA" }), row({ ticker: "AXTI", composite_score: 1 })];
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, [rows[0]!], extrasFor(rows));
  assert.ok(out.length >= 2);
  for (const r of out) assert.equal(r.edition_for, "2026-09-17");
});

test("buildDiscoveryStageSnapshotRows (Phase 2A part 2): market_regime defaults to null when omitted, never a silent crash", () => {
  const rows = [row({ ticker: "NVDA" })];
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, rows, extrasFor(rows));
  assert.equal(out[0]!.snapshot_json.market_regime, null);
});

test("buildDiscoveryStageSnapshotRows (Phase 2A part 2): the SAME market_regime object is stamped on every row this edition build produces -- one fact about the whole market, not per-ticker", () => {
  const rows = [row({ ticker: "NVDA" }), row({ ticker: "AXTI", composite_score: 1 })];
  const regime = { schema_version: 1 as const, trend: "up" as const, spx_close: 100, spx_sma20: 95, volatility: "normal" as const, vix_close: 18, gap_pattern: null, gap_pct: null, event_day: false };
  const out = buildDiscoveryStageSnapshotRows("2026-09-17", rows, [rows[0]!], extrasFor(rows), regime);
  for (const r of out) assert.deepEqual(r.snapshot_json.market_regime, regime);
});
