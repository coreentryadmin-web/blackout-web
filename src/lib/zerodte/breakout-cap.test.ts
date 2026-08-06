import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBreakoutCandidateCap } from "./breakout-cap";

// Dynamic-N formula (2026-08-04): max(floor, min(ceiling, ceil(qualifyingMovers * 0.30))).
// Default floor=40 / ceiling=100 mirror the shipped breakout-discovery.ts constants; tests pass
// them explicitly so this file stays correct even if those constants change independently.

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
  assert.equal(cap, 100); // DEFAULT_CEILING
  const capThin = resolveBreakoutCandidateCap({ qualifyingMovers: 10 });
  assert.equal(capThin, 40); // DEFAULT_FLOOR
});

test("resolveBreakoutCandidateCap: kill-switch (disabled) reverts to the static floor regardless of pool size", () => {
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: 390, floor: 40, ceiling: 100, disabled: true });
  assert.equal(cap, 40, "kill-switch must ignore the huge qualifying pool and return the static floor");
});
