import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBreakoutCandidateCap, resolveBreakoutDynamicCapDisabled } from "./breakout-cap";

// Dynamic-N formula (2026-08-04): max(floor, min(ceiling, ceil(qualifyingMovers * 0.30))).
// Default floor=40 / ceiling=150 (raised 2026-08-24 from 100) mirror the shipped breakout-discovery.ts
// constants; tests pass them explicitly so this file stays correct even if those constants change independently.

test("resolveBreakoutCandidateCap: thin day stays at the floor (never worse than the old static cap)", () => {
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: 60, floor: 40, ceiling: 100 });
  assert.equal(cap, 40); // ceil(60*0.30)=18 < floor(40) → clamped up to the floor
});

test("resolveBreakoutCandidateCap: zero qualifying movers stays at the floor", () => {
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: 0, floor: 40, ceiling: 100 });
  assert.equal(cap, 40);
});

test("resolveBreakoutCandidateCap: mid-breadth day scales up proportionally", () => {
  // Real 2026-07-21 evidence: qualifying=294 → ceil(294*0.30)=89, within [40,100].
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: 294, floor: 40, ceiling: 100 });
  assert.equal(cap, 89);
});

test("resolveBreakoutCandidateCap: huge-breadth day is bounded at the ceiling, not 1:1 with the pool", () => {
  // Real 2026-07-30 evidence: qualifying=390 → ceil(390*0.30)=117 > ceiling(100) → clamped down.
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: 390, floor: 40, ceiling: 100 });
  assert.equal(cap, 100);
});

test("resolveBreakoutCandidateCap: an extreme pool never exceeds the ceiling", () => {
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: 5000, floor: 40, ceiling: 100 });
  assert.equal(cap, 100);
});

test("resolveBreakoutCandidateCap: default floor/ceiling apply when omitted", () => {
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: 1000 });
  assert.equal(cap, 150); // DEFAULT_CEILING (raised 2026-08-24 from 100)
  const capThin = resolveBreakoutCandidateCap({ qualifyingMovers: 10 });
  assert.equal(capThin, 40); // DEFAULT_FLOOR
});

test("resolveBreakoutCandidateCap: kill-switch (disabled) reverts to the static floor regardless of pool size", () => {
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: 390, floor: 40, ceiling: 100, disabled: true });
  assert.equal(cap, 40, "kill-switch must ignore the huge qualifying pool and return the static floor");
});

// ── NH-2 (2026-08-22): the bare `BREAKOUT_DYNAMIC_CAP` name was deployed and unread ──────────────
// Production ships BREAKOUT_DYNAMIC_CAP="1" while the module only ever consulted
// BREAKOUT_DYNAMIC_CAP_DISABLED, so the deployed value matched intent by coincidence. The failing
// operation was the INVERSE one: setting BREAKOUT_DYNAMIC_CAP=0 to revert did nothing, silently.
// These pin BOTH names and, critically, the precedence between them.

test("resolveBreakoutDynamicCapDisabled: neither name set → enabled (today's default, unchanged)", () => {
  assert.equal(resolveBreakoutDynamicCapDisabled({}), false);
});

test("resolveBreakoutDynamicCapDisabled: the deployed value BREAKOUT_DYNAMIC_CAP=1 → enabled", () => {
  // The exact production config at the time of the finding. Must be a no-op change.
  assert.equal(resolveBreakoutDynamicCapDisabled({ BREAKOUT_DYNAMIC_CAP: "1" }), false);
});

test("resolveBreakoutDynamicCapDisabled: BREAKOUT_DYNAMIC_CAP=0 now actually disables (the bug)", () => {
  // Pre-fix this returned false — the operator's revert silently did nothing.
  assert.equal(resolveBreakoutDynamicCapDisabled({ BREAKOUT_DYNAMIC_CAP: "0" }), true);
  for (const off of ["false", "off", "no", "OFF", " 0 "]) {
    assert.equal(resolveBreakoutDynamicCapDisabled({ BREAKOUT_DYNAMIC_CAP: off }), true, `"${off}" must disable`);
  }
});

test("resolveBreakoutDynamicCapDisabled: legacy kill-switch still works on its own", () => {
  assert.equal(resolveBreakoutDynamicCapDisabled({ BREAKOUT_DYNAMIC_CAP_DISABLED: "1" }), true);
});

test("resolveBreakoutDynamicCapDisabled: the EMERGENCY kill-switch beats a stale enable flag", () => {
  // The precedence that matters: a leftover BREAKOUT_DYNAMIC_CAP=1 in the deploy config must never
  // defeat someone actively reverting during an incident.
  assert.equal(
    resolveBreakoutDynamicCapDisabled({ BREAKOUT_DYNAMIC_CAP: "1", BREAKOUT_DYNAMIC_CAP_DISABLED: "1" }),
    true,
    "BREAKOUT_DYNAMIC_CAP_DISABLED must win outright"
  );
});

test("resolveBreakoutDynamicCapDisabled: an unrecognised value is not treated as a disable", () => {
  // Fail toward the shipped default rather than silently reverting on a typo.
  assert.equal(resolveBreakoutDynamicCapDisabled({ BREAKOUT_DYNAMIC_CAP: "maybe" }), false);
  assert.equal(resolveBreakoutDynamicCapDisabled({ BREAKOUT_DYNAMIC_CAP: "" }), false);
});
