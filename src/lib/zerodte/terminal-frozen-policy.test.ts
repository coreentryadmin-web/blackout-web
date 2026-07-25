// Terminal v2 — the REAL frozen-policy read path a committed row's terminal ladder resolves
// through: entry_context.exit_policy_snapshot → readFrozenExitPolicy → buildTerminalExitLadder.
// This is the exact chain resolveExitLadder() in zerodte-service.ts runs, exercised on the
// genuine snapshot shape (buildResolvedExitPolicy) rather than a hand-built stub.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFrozenExitMode, readFrozenExitPolicy } from "./exit-sync.ts";
import { buildResolvedExitPolicy } from "./strategy-version.ts";
import { buildTerminalExitLadder } from "./terminal-ladder.ts";

test("frozen policy: a committed trim_scale snapshot resolves to a priced, fired ⅓/⅓ ladder", () => {
  const entryContext = {
    exit_policy_at_commit: "trim_scale",
    exit_policy_snapshot: buildResolvedExitPolicy("trim_scale"),
  } as Record<string, unknown>;

  const frozen = readFrozenExitPolicy(entryContext);
  assert.ok(frozen, "the snapshot reads back as a resolved policy");
  assert.equal(frozen!.policy, "trim_scale");

  // entry 2.0, peak reached 2.6 (+30%) → first trim (+25% = 2.5) FIRED, second (+50% = 3.0) pending.
  const ladder = buildTerminalExitLadder(frozen!, 2.0, 2.6);
  assert.equal(ladder.policy, "trim_scale");
  assert.equal(ladder.trim_levels[0]!.fired, true);
  assert.equal(ladder.trim_levels[1]!.fired, false);
  assert.equal(ladder.stop_premium, 1.0);
  assert.equal(ladder.target_premium, 4.0);
});

test("frozen policy: a ratchet snapshot resolves to a single-trim ratchet ladder", () => {
  const entryContext = {
    exit_policy_at_commit: "ratchet",
    exit_policy_snapshot: buildResolvedExitPolicy("ratchet"),
  } as Record<string, unknown>;
  assert.equal(readFrozenExitMode(entryContext), "ratchet");
  const ladder = buildTerminalExitLadder(readFrozenExitPolicy(entryContext)!, 1.2, 1.2);
  assert.equal(ladder.policy, "ratchet");
  assert.equal(ladder.trim_levels.length, 1);
});

test("frozen policy: a legacy row (no snapshot) reads null — caller keeps the legacy render", () => {
  assert.equal(readFrozenExitPolicy(null), null);
  assert.equal(readFrozenExitPolicy({}), null);
  assert.equal(readFrozenExitMode({}), null);
  // A malformed blob (missing numeric stop/target) must read as absent, not a partial policy.
  assert.equal(readFrozenExitPolicy({ exit_policy_snapshot: { config_hash: "x" } }), null);
});
