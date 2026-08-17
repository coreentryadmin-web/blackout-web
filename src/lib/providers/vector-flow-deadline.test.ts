import test from "node:test";
import assert from "node:assert/strict";
import { vectorFlowMaxBlockMs } from "./config";

// Guards the deadline that stops /api/market/vector/flow riding to the ALB's 120s idle timeout.
// Measured live 2026-08-17: SPY 504 @ 120.1s and 85.9s, NVDA 41.7s, interleaved with sub-second
// responses on the same ticker.

const withEnv = (v: string | undefined, fn: () => void) => {
  const prev = process.env.VECTOR_FLOW_MAX_BLOCK_MS;
  if (v === undefined) delete process.env.VECTOR_FLOW_MAX_BLOCK_MS;
  else process.env.VECTOR_FLOW_MAX_BLOCK_MS = v;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.VECTOR_FLOW_MAX_BLOCK_MS;
    else process.env.VECTOR_FLOW_MAX_BLOCK_MS = prev;
  }
};

test("default deadline preserves observed successful reads but kills the pathological tail", () => {
  withEnv(undefined, () => {
    const ms = vectorFlowMaxBlockMs();
    // Real data-carrying responses were measured at 11.6s / 16.4s / 21.9s — a tighter cap would
    // turn those into empty panels, which is a different bug, not a fix.
    assert.ok(ms > 21_900, `deadline ${ms}ms would discard a measured successful 21.9s read`);
    // ...while still landing well inside the 120s ALB idle timeout that produced the 504.
    assert.ok(ms < 120_000, `deadline ${ms}ms does not beat the ALB's 120s timeout`);
  });
});

test("deadline is env-tunable so it can be tightened without a deploy", () => {
  withEnv("8000", () => assert.equal(vectorFlowMaxBlockMs(), 8_000));
});

test("deadline never exceeds the ALB idle timeout, however it is configured", () => {
  // A cap above 120s would reintroduce exactly the 504 this exists to prevent.
  for (const v of ["999999", "120000", "500000"]) {
    withEnv(v, () => assert.ok(vectorFlowMaxBlockMs() <= 115_000, `${v} -> ${vectorFlowMaxBlockMs()}`));
  }
});

test("garbage or absurdly small values fall back to the default rather than disabling the read", () => {
  // A 0/negative/NaN cap would make every flow request instantly empty — worse than the hang.
  for (const v of ["0", "-1", "abc", "50"]) {
    withEnv(v, () => assert.equal(vectorFlowMaxBlockMs(), 25_000, `${v} should fall back`));
  }
});
