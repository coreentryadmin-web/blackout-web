// WS-02/05/06 hardening — the commit-time freezes. Pure-core tests (no DB/clock in the
// paths asserted): the immutable exit-policy snapshot + its drift-guard, a grader honoring a
// snapshot whose numbers differ from current code, the frozen concentration MEASURE, and the
// full origin maps. All four freezes are ADDITIVE — they change no committed play and no grade;
// these tests pin exactly that (the snapshot is READ by the grader, the concentration/origin
// maps are evidence only).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildResolvedExitPolicy,
  exitPolicyGraderParams,
  type ResolvedExitPolicy,
} from "./strategy-version";
import { EXIT_VERSION } from "./strategy-version";
import { gradePlanFromBars, PLAN_RULES, type PlanBar } from "./plan";
import { readFrozenExitPolicy } from "./exit-sync";
import {
  freezeConcentrationState,
  correlationGroupOf,
  correlationGroupId,
  CONCENTRATION_POLICY_VERSION,
} from "./governor";
import {
  buildOriginMaps,
  recordOriginContributionsOnMerge,
  unionDiscoveryOrigins,
  MERGE_POLICY_VERSION,
  type EnrichedZeroDteSetup,
} from "./board";

// ── WS-02: buildResolvedExitPolicy round-trip + DRIFT-GUARD ─────────────────────────
// GOLDEN hashes committed here. The whole point: a silent numeric edit to any exit constant
// (PLAN_RULES stop/target/time-stop, EXIT_RULES arm/lock/runner floors, TRIM_SCALE tranches)
// changes config_hash; if that edit is NOT accompanied by an EXIT_VERSION bump, THIS test
// fails, forcing the deliberate version bump the calibration cohort relies on.
const GOLDEN_RATCHET_HASH = "exitcfg-26da6211";
const GOLDEN_TRIM_SCALE_HASH = "exitcfg-1ace50c7";

test("WS-02 buildResolvedExitPolicy: resolves the real numeric exit params from the sources of truth", () => {
  const r = buildResolvedExitPolicy("ratchet");
  assert.equal(r.policy, "ratchet");
  assert.equal(r.version, EXIT_VERSION);
  // Numbers come straight from PLAN_RULES — the snapshot mirrors the code exactly at build time.
  assert.equal(r.hard_stop_pct, PLAN_RULES.stop_pct);
  assert.equal(r.target_pct, PLAN_RULES.target_pct);
  assert.equal(r.time_stop_et, "15:50");
  assert.equal(r.collision_rule, "stop_before_target_same_bar");
  assert.deepEqual(r.trim_levels, [{ trigger_pct: 100, fraction: 0.5 }]);
  assert.equal(r.runner_fraction, 0.5);

  const t = buildResolvedExitPolicy("trim_scale");
  assert.equal(t.policy, "trim_scale");
  // trim_scale's neutral ladder: ⅓@+25%, ⅓@+50%.
  assert.equal(t.trim_levels.length, 2);
  assert.deepEqual(t.trim_levels.map((l) => l.trigger_pct), [20, 50]);
  const trend = buildResolvedExitPolicy("trim_scale", { target_pct: 300, regime: "trend" });
  assert.deepEqual(trend.trim_levels.map((l) => l.trigger_pct), [40, 80]);
  assert.equal(trend.target_pct, 300);
  assert.equal(trend.trim_levels[0]!.fraction, 0.25);
  assert.equal(trend.runner_fraction, 0.5);
});

test("WS-02 DRIFT-GUARD: resolved config_hash matches the committed golden (a silent numeric edit trips this)", () => {
  // If this assertion fails after an intentional exit-rule change, BUMP EXIT_VERSION in the same
  // PR and update these goldens — that is the deliberate cohort-partitioning act the guard enforces.
  assert.equal(buildResolvedExitPolicy("ratchet").config_hash, GOLDEN_RATCHET_HASH);
  assert.equal(buildResolvedExitPolicy("trim_scale").config_hash, GOLDEN_TRIM_SCALE_HASH);
  // The two modes must never collide on one hash (they grade the same entry differently).
  assert.notEqual(GOLDEN_RATCHET_HASH, GOLDEN_TRIM_SCALE_HASH);
});

test("WS-02 config_hash is stable + deterministic across repeated builds (pure, order-independent)", () => {
  assert.equal(buildResolvedExitPolicy("ratchet").config_hash, buildResolvedExitPolicy("ratchet").config_hash);
});

test("WS-02 readFrozenExitPolicy: returns a present snapshot, null-guards legacy/malformed rows", () => {
  const snap = buildResolvedExitPolicy("ratchet");
  assert.deepEqual(readFrozenExitPolicy({ exit_policy_snapshot: snap }), snap);
  // Legacy row (no snapshot) → null → graders fall back to current code (prior behavior).
  assert.equal(readFrozenExitPolicy({}), null);
  assert.equal(readFrozenExitPolicy(null), null);
  // Malformed (missing numeric params) → treated as absent, never a partial policy.
  assert.equal(readFrozenExitPolicy({ exit_policy_snapshot: { config_hash: "x" } }), null);
});

// ── WS-02: a grader replaying a row honors the SNAPSHOT over current code ────────────
test("WS-02 gradePlanFromBars honors the frozen snapshot params, not current PLAN_RULES", () => {
  const T = Date.UTC(2023, 10, 14, 15, 0, 0); // 2023-11-14 10:00 ET (EST) — inside RTH, before 15:30
  const MIN = 60_000;
  const bar = (i: number, h: number, l: number, c: number): PlanBar => ({ t: T + (i + 1) * MIN, h, l, c });
  const entry = 10;

  // A frozen policy whose TARGET is +50% (double-vs-code's +100%). A bar that peaks at 16 (a +60%
  // premium move) DOUBLES under the snapshot (target 15) but NOT under current code (target 20).
  const frozen: ResolvedExitPolicy = { ...buildResolvedExitPolicy("ratchet"), target_pct: 50 };
  const params = exitPolicyGraderParams(frozen);

  const bars = [bar(0, 12, 9.5, 11), bar(1, 16, 11, 15.5)];
  // Under the SNAPSHOT (target +50% → 15): doubled.
  assert.equal(gradePlanFromBars(bars, entry, T, params).outcome, "doubled");
  // Under CURRENT CODE (no params, target +100% → 20): 16 never reaches 20 → time_stop, not doubled.
  assert.equal(gradePlanFromBars(bars, entry, T).outcome, "time_stop");

  // And a frozen STOP that is tighter (−20% → 8) stops a −25% dip that current code (−50% → 5) rides.
  const tightStop = exitPolicyGraderParams({ ...buildResolvedExitPolicy("ratchet"), hard_stop_pct: -20 });
  const dip = [bar(0, 10.5, 7.5, 8)];
  assert.equal(gradePlanFromBars(dip, entry, T, tightStop).outcome, "stopped");
  assert.equal(gradePlanFromBars(dip, entry, T).outcome, "time_stop");
});

// ── WS-05: freeze concentration state (2 same-beta longs) ───────────────────────────
test("WS-05 freezeConcentrationState: measures a 2-same-beta-long book, evidence-only", () => {
  const candidate = { ticker: "QQQ", direction: "long" as const };
  // Open book: two correlated broad-index longs (SPY, IWM) + one uncorrelated long (AAPL).
  const openPlans = [
    { ticker: "SPY", direction: "long" as const },
    { ticker: "IWM", direction: "long" as const },
    { ticker: "AAPL", direction: "long" as const },
  ];
  const c = freezeConcentrationState(candidate, openPlans, { aggregatePremiumAtRisk: 300_000 });

  assert.equal(c.same_direction_open_count, 3); // all three existing plans are long
  assert.equal(c.same_beta_open_count, 2); // SPY + IWM share QQQ's correlation group; AAPL doesn't
  const group = correlationGroupOf("QQQ")!;
  assert.deepEqual(c.correlation_group_ids, [correlationGroupId(group)]);
  assert.deepEqual(c.existing_open_setup_ids, ["AAPL:long", "IWM:long", "SPY:long"]);
  assert.equal(c.gross_directional_count, 3);
  assert.equal(c.aggregate_premium_at_risk, 300_000);
  assert.equal(c.concentration_policy_version, CONCENTRATION_POLICY_VERSION);

  // Candidate excluded from its own counts (a refresh of the same name isn't another exposure).
  const withSelf = freezeConcentrationState(candidate, [...openPlans, { ticker: "QQQ", direction: "long" }], {});
  assert.equal(withSelf.gross_directional_count, 3);
  assert.equal(withSelf.aggregate_premium_at_risk, null); // not supplied → honest null, never 0
});

// ── WS-06: full origin maps, 3-origin / 2-direction, direction_owner=FLOW ────────────
test("WS-06 buildOriginMaps: captures every rail's direction+score, owner FLOW, ALL disagreements", () => {
  // Minimal casts — buildOriginMaps/recordOriginContributionsOnMerge only read
  // discovery_origin, direction, score, origin_contributions.
  const kept = { direction: "long", score: 80, discovery_origin: ["FLOW"] } as unknown as EnrichedZeroDteSetup;
  const breakout = { direction: "long", score: 60, discovery_origin: ["BREAKOUT"] } as unknown as EnrichedZeroDteSetup;
  const pin = { direction: "short", score: 40, discovery_origin: ["PIN"] } as unknown as EnrichedZeroDteSetup;

  // Simulate the two merges scan.ts performs (record BEFORE the union rewrites discovery_origin).
  recordOriginContributionsOnMerge(kept, breakout);
  kept.discovery_origin = unionDiscoveryOrigins(kept.discovery_origin, breakout.discovery_origin);
  recordOriginContributionsOnMerge(kept, pin);
  kept.discovery_origin = unionDiscoveryOrigins(kept.discovery_origin, pin.discovery_origin);

  const maps = buildOriginMaps(kept);
  assert.deepEqual(maps.origin_direction_map, { FLOW: "long", BREAKOUT: "long", PIN: "short" });
  assert.deepEqual(maps.origin_score_map, { FLOW: 80, BREAKOUT: 60, PIN: 40 });
  assert.equal(maps.direction_owner, "FLOW"); // FLOW score 80 > BREAKOUT 60 among agreeing longs
  assert.deepEqual(maps.disagreeing_origins, ["PIN"]); // ALL disagreements, not just the first pair
  assert.equal(maps.merge_policy_version, MERGE_POLICY_VERSION);
  assert.equal(MERGE_POLICY_VERSION, "v2");
});

test("WS-06 buildOriginMaps: v2 owner is highest-score agreeing rail (BREAKOUT can own)", () => {
  const kept = { direction: "long", score: 90, discovery_origin: ["FLOW", "BREAKOUT"] } as unknown as EnrichedZeroDteSetup;
  kept.origin_contributions = {
    FLOW: { direction: "long", score: 70 },
    BREAKOUT: { direction: "long", score: 90 },
  };
  const maps = buildOriginMaps(kept);
  assert.equal(maps.direction_owner, "BREAKOUT");
  assert.deepEqual(maps.disagreeing_origins, []);
});

test("WS-06 buildOriginMaps: a single-origin setup seeds its own rail (no merge needed)", () => {
  const flowOnly = { direction: "short", score: 71, discovery_origin: ["FLOW"] } as unknown as EnrichedZeroDteSetup;
  const maps = buildOriginMaps(flowOnly);
  assert.deepEqual(maps.origin_direction_map, { FLOW: "short" });
  assert.deepEqual(maps.origin_score_map, { FLOW: 71 });
  assert.equal(maps.direction_owner, "FLOW");
  assert.deepEqual(maps.disagreeing_origins, []);
});
