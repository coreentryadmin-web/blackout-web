import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeShadowGateEvidence,
  primaryShadowBlockedDimension,
  SHADOW_GATE_PROVISIONAL_MIN_N,
  SHADOW_GATE_REVIEW_MIN_N,
} from "./shadow-calibration.js";

test("primaryShadowBlockedDimension prefers budget/cap/gate tokens", () => {
  assert.equal(primaryShadowBlockedDimension(["budget:per_position_loss", "other"]), "budget:per_position_loss");
  assert.equal(primaryShadowBlockedDimension(["gate:G-S14:cortex_veto:x"]), "gate:G-S14:cortex_veto:x");
});

test("analyzeShadowGateEvidence stages provisional at n=10 and review at n=30", () => {
  const rows = Array.from({ length: SHADOW_GATE_PROVISIONAL_MIN_N }, (_, i) => ({
    blocked_by: ["budget:per_position_loss"],
    realized_pnl_pct: i % 2 === 0 ? 15 : -10,
    graded_at: "2026-09-05T12:00:00.000Z",
  }));
  const provisional = analyzeShadowGateEvidence(rows);
  assert.equal(provisional[0]?.tier, "PROVISIONAL");
  assert.equal(provisional[0]?.recommendReview, false);

  const reviewRows = Array.from({ length: SHADOW_GATE_REVIEW_MIN_N }, () => ({
    blocked_by: ["cap:max_same_week_expiry"],
    realized_pnl_pct: 20,
    graded_at: "2026-09-05T12:00:00.000Z",
  }));
  const review = analyzeShadowGateEvidence(reviewRows);
  assert.equal(review[0]?.tier, "REVIEW_READY");
  assert.equal(review[0]?.recommendReview, true);
  assert.equal(review[0]?.winRatePct, 100);
});
