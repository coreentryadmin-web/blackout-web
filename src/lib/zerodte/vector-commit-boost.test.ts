import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVectorGateBoost, vectorExemptsG17PrimeBand } from "./vector-commit-boost";
import type { ZeroDteVectorPulse } from "./vector-crosslink-core";

const pulse = (over: Partial<ZeroDteVectorPulse>): ZeroDteVectorPulse => ({
  premium_pct: 60,
  peak_premium_pct: 70,
  action_status: "still_buy",
  is_winner: false,
  is_runner: false,
  side: "call",
  direction: "long",
  strike: 100,
  occ: "X",
  rank: 1,
  role: "magnet",
  ...over,
});

test("computeVectorGateBoost: aligned Vector winner exempts G-17 and bumps score", () => {
  const b = computeVectorGateBoost("long", 68, pulse({ is_winner: true }));
  assert.equal(b.g17_exempt, true);
  assert.equal(b.score_bump, 8);
  assert.equal(b.confluence_credit, 1);
});

test("vectorExemptsG17PrimeBand: opposite direction does not exempt", () => {
  assert.equal(vectorExemptsG17PrimeBand("short", 68, pulse({ is_winner: true, direction: "long" })), false);
});

test("computeVectorGateBoost: score 68 + aligned runner exempts G-17 after bump", () => {
  const b = computeVectorGateBoost("long", 68, pulse({ is_runner: true, is_winner: false }));
  assert.equal(b.g17_exempt, true);
  assert.equal(b.score_bump, 4);
});
