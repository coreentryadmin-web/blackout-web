import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeTurnPhases } from "@/lib/largo/turn-phase-timings";

test("splits prefetch vs loop from three contiguous clock reads", () => {
  const t = summarizeTurnPhases({
    depth: "concrete",
    startedAt: 1_000,
    loopStartedAt: 4_500, // 3.5s of prefetch
    endedAt: 34_500, // 30.0s in the loop
    toolCount: 3,
    answered: false,
  });
  assert.equal(t.prefetch_ms, 3_500);
  assert.equal(t.loop_ms, 30_000);
  assert.equal(t.total_ms, 33_500);
  assert.equal(t.depth, "concrete");
  assert.equal(t.tools, 3);
  assert.equal(t.answered, false);
});

test("on a healthy clock total == prefetch + loop (the diagnostic identity)", () => {
  const t = summarizeTurnPhases({
    depth: "deep",
    startedAt: 100,
    loopStartedAt: 2_100,
    endedAt: 70_100,
    toolCount: 7,
    answered: true,
  });
  assert.equal(t.total_ms, t.prefetch_ms + t.loop_ms);
});

test("clamps negative spans to 0 (Date.now can step backward on an NTP adjustment)", () => {
  const t = summarizeTurnPhases({
    depth: "concrete",
    startedAt: 5_000,
    loopStartedAt: 4_000, // clock went backward before the loop
    endedAt: 3_000, // and again before it ended
    toolCount: 0,
    answered: false,
  });
  assert.equal(t.prefetch_ms, 0);
  assert.equal(t.loop_ms, 0);
  assert.equal(t.total_ms, 0);
});

test("carries the answered flag so an empty fallback is distinguishable from a real answer", () => {
  const answered = summarizeTurnPhases({
    depth: "concrete", startedAt: 0, loopStartedAt: 1_000, endedAt: 10_000, toolCount: 2, answered: true,
  });
  const empty = summarizeTurnPhases({
    depth: "concrete", startedAt: 0, loopStartedAt: 1_000, endedAt: 31_000, toolCount: 2, answered: false,
  });
  assert.equal(answered.answered, true);
  assert.equal(empty.answered, false);
  // The two turns took different total time and only one produced an answer — the pair a slow-spell
  // triage actually needs: was the long turn the one that fell back?
  assert.ok(empty.total_ms > answered.total_ms);
});
