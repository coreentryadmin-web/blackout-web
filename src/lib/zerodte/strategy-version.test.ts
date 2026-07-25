// Pure-core tests for the strategy version manifest + config hash (design Q12 —
// INTEGRITY) and the calibration version-cohort partition it feeds. No providers, no
// DB, no clock: buildStrategyManifest / strategyConfigHash / partitionByVersion are
// deterministic, so the homogeneity guarantee (old-version plays never blend into the
// current-hash bands) is pinned exactly.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildStrategyManifest,
  strategyConfigHash,
  currentStrategyConfigHash,
  EXIT_POLICY,
  FEATURE_SCHEMA_VERSION,
  type StrategyManifest,
} from "./strategy-version";
import { DEFAULT_EXIT_MODE } from "./exit-engine";
import {
  FEATURE_VECTOR_VERSION,
  buildSetupFeatureVector,
  type SetupFeatureInputs,
} from "./feature-vector";
import {
  analyzeGateCalibration,
  partitionByVersion,
  readStrategyConfigHash,
  type CalibrationPlayRow,
} from "./calibration";

// ── The manifest module ────────────────────────────────────────────────────────────

test("buildStrategyManifest: every subsystem field present; derived fields track their source of truth", () => {
  const m = buildStrategyManifest();
  // All eleven manifest fields exist (a missing field would silently drop a subsystem
  // from the fingerprint, so a change to it would NOT partition calibration).
  const keys = Object.keys(m).sort();
  assert.deepEqual(keys, [
    "contract_selector",
    "cortex",
    "discovery",
    "engine",
    "exit",
    "exit_policy",
    "feature_schema",
    "gate",
    "governor",
    "grader",
    "scorer",
  ]);
  // The two DERIVED fields must equal their source of truth, so the manifest can never
  // drift from the shipped exit default or the persisted feature-vector schema version.
  assert.equal(m.exit_policy, DEFAULT_EXIT_MODE);
  assert.equal(EXIT_POLICY, DEFAULT_EXIT_MODE);
  assert.equal(m.feature_schema, `v${FEATURE_VECTOR_VERSION}`);
  assert.equal(FEATURE_SCHEMA_VERSION, `v${FEATURE_VECTOR_VERSION}`);
});

test("strategyConfigHash: cfg- prefixed 8-hex, stable across key order, deterministic", () => {
  const m = buildStrategyManifest();
  const h = strategyConfigHash(m);
  assert.match(h, /^cfg-[0-9a-f]{8}$/);
  // Same call twice → identical (pure, no clock/rng).
  assert.equal(strategyConfigHash(m), h);
  // Key INSERTION ORDER must not matter — the canonical form sorts by key. Rebuild the
  // same values in a deliberately shuffled object and assert the hash is unchanged.
  const shuffled: StrategyManifest = {
    grader: m.grader,
    exit: m.exit,
    exit_policy: m.exit_policy,
    contract_selector: m.contract_selector,
    governor: m.governor,
    cortex: m.cortex,
    gate: m.gate,
    scorer: m.scorer,
    discovery: m.discovery,
    engine: m.engine,
    feature_schema: m.feature_schema,
  };
  assert.equal(strategyConfigHash(shuffled), h);
});

test("strategyConfigHash: ANY field change flips the hash (the partition trigger)", () => {
  const base = buildStrategyManifest();
  const h0 = strategyConfigHash(base);
  // Bump each field in turn — every one must move the hash, else a change to that
  // subsystem would fail to partition calibration (the exact corruption Q12 closes).
  for (const k of Object.keys(base) as Array<keyof StrategyManifest>) {
    const mutated = { ...base, [k]: `${base[k]}-CHANGED` } as StrategyManifest;
    assert.notEqual(
      strategyConfigHash(mutated),
      h0,
      `bumping ${k} must change the config hash`
    );
  }
});

test("currentStrategyConfigHash === hash of the current manifest", () => {
  assert.equal(currentStrategyConfigHash(), strategyConfigHash(buildStrategyManifest()));
});

// ── Feature-vector threading ────────────────────────────────────────────────────────

test("buildSetupFeatureVector: strategy_config_hash threads through; absent → null (never fabricated)", () => {
  // Minimal valid inputs (only the required fields buildSetupFeatureVector dereferences);
  // the assertion is purely about the strategy_config_hash passthrough.
  const base: SetupFeatureInputs = {
    ticker: "spy",
    direction: "long",
    etMinutes: 65,
    evidenceScore: 82,
  };
  const withHash = buildSetupFeatureVector({ ...base, strategyConfigHash: "cfg-deadbeef" });
  assert.equal(withHash.strategy_config_hash, "cfg-deadbeef");
  // Not threaded → an honest null "unversioned" read, not a stand-in current hash.
  const without = buildSetupFeatureVector(base);
  assert.equal(without.strategy_config_hash, null);
});

// ── Calibration version-cohort partition ────────────────────────────────────────────

const CURRENT = currentStrategyConfigHash();

/** A graded row stamped with a given config hash (null = legacy/unstamped). `win`
 *  drives the outcome so a cohort's win-rate is checkable. score in entry_context so it
 *  lands in a score band. */
function hashRow(hash: string | null, win: boolean): CalibrationPlayRow {
  const ec: Record<string, unknown> = { score: 80 };
  if (hash != null) ec.strategy_config_hash = hash;
  return {
    session_date: "2026-07-10",
    ticker: "SPY",
    direction: "long",
    score_max: 80,
    plan_outcome: win ? "doubled" : "stopped",
    plan_pnl_pct: win ? 100 : -50,
    entry_context: ec,
    gate_calibration_json: { score_at_commit: 80 },
  } as CalibrationPlayRow;
}

test("readStrategyConfigHash: reads the frozen stamp; missing/blank → null", () => {
  assert.equal(readStrategyConfigHash({ strategy_config_hash: "cfg-1234abcd" }), "cfg-1234abcd");
  assert.equal(readStrategyConfigHash({ strategy_config_hash: "" }), null);
  assert.equal(readStrategyConfigHash({}), null);
  assert.equal(readStrategyConfigHash(null), null);
});

test("partitionByVersion: default cohort = current-hash + legacy; only a DIFFERENT KNOWN hash is split off", () => {
  const rows = [
    hashRow(CURRENT, true),
    hashRow(CURRENT, false),
    hashRow("cfg-00000001", true), // older strategy A (different known hash)
    hashRow("cfg-00000001", true),
    hashRow("cfg-00000002", false), // older strategy B (different known hash)
    hashRow(null, true), // legacy, pre-stamp — folded in per the transition rule
  ];
  const { analysis, summary } = partitionByVersion(rows, CURRENT, false);
  // Default analysis = current-hash rows (2) + legacy null-hash rows (1) = 3; the two
  // different-known-hash rows are excluded.
  assert.equal(analysis.length, 3);
  assert.equal(summary.aggregation, "current_and_legacy");
  assert.equal(summary.current_hash, CURRENT);
  assert.equal(summary.n_current, 2);
  assert.equal(summary.n_older, 3); // 2×A + 1×B, held apart
  assert.equal(summary.n_unversioned, 1); // legacy, but INCLUDED in analysis
  // older_hashes breakdown, largest cohort first.
  assert.deepEqual(summary.older_hashes, [
    { hash: "cfg-00000001", n: 2 },
    { hash: "cfg-00000002", n: 1 },
  ]);
});

test("partitionByVersion: behavior-neutral rollout — an all-legacy (unstamped) ledger is analyzed in full", () => {
  // The existing production ledger is entirely pre-stamp. Excluding it would blank
  // calibration on rollout; the transition rule folds legacy rows into the default set,
  // so a fully-unstamped population is analyzed unchanged (nothing held apart).
  const rows = [hashRow(null, true), hashRow(null, false), hashRow(null, true)];
  const { analysis, summary } = partitionByVersion(rows, CURRENT, false);
  assert.equal(analysis.length, 3);
  assert.equal(summary.n_current, 0);
  assert.equal(summary.n_older, 0);
  assert.equal(summary.n_unversioned, 3);
  assert.deepEqual(summary.older_hashes, []);
});

test("partitionByVersion: crossVersion:true analyzes EVERY graded row (explicit blend), summary still reports the split", () => {
  const rows = [hashRow(CURRENT, true), hashRow("cfg-00000001", false), hashRow(null, true)];
  const { analysis, summary } = partitionByVersion(rows, CURRENT, true);
  assert.equal(analysis.length, 3);
  assert.equal(summary.aggregation, "cross_version");
  // The partition counts are unchanged — the opt-in changes the ANALYSIS set, not the
  // reported truth about how many versions the ledger spans.
  assert.equal(summary.n_current, 1);
  assert.equal(summary.n_older, 1);
  assert.equal(summary.n_unversioned, 1);
});

test("analyzeGateCalibration: default bands are HOMOGENEOUS — older-version losers can't drag the current cohort's win-rate", () => {
  // 10 current-hash rows, ALL winners. 10 older-hash rows, ALL losers. If the analyzer
  // blended them the score band would read 50% WR; homogeneity means it reads 100%.
  const rows = [
    ...Array.from({ length: 10 }, () => hashRow(CURRENT, true)),
    ...Array.from({ length: 10 }, () => hashRow("cfg-00000001", false)),
  ];
  const win = { since: "2026-07-01", through: "2026-07-31", days: 31 };
  const report = analyzeGateCalibration({ rows, window: win });
  // The version cohort summary sees the whole partition…
  assert.equal(report.version_cohort.n_current, 10);
  assert.equal(report.version_cohort.n_older, 10);
  // …but the analyzed bands only counted the 10 current-hash winners.
  const band = report.score_bands.find((b) => b.n > 0);
  assert.ok(band, "expected a populated score band");
  assert.equal(band.n, 10);
  assert.equal(band.wins, 10);

  // Same population, explicit cross-version opt-in → now all 20 are analyzed together.
  const blended = analyzeGateCalibration({ rows, window: win, crossVersion: true });
  assert.equal(blended.version_cohort.aggregation, "cross_version");
  const blendedBand = blended.score_bands.find((b) => b.n > 0);
  assert.ok(blendedBand, "expected a populated score band");
  assert.equal(blendedBand.n, 20);
  assert.equal(blendedBand.wins, 10);
});
