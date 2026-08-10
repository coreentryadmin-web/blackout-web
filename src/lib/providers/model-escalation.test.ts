import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ESCALATE_AFTER_ROUNDS,
  didEscalate,
  escalateAfterRounds,
  modelForRound,
} from "./model-escalation";

const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-sonnet-4-6";

test("rounds below the threshold stay on the base model", () => {
  for (let r = 0; r < 3; r++) {
    assert.equal(modelForRound(r, HAIKU, SONNET, 3), HAIKU, `round ${r} should stay on base`);
  }
});

test("the threshold round and every round after it escalate", () => {
  for (const r of [3, 4, 7, 11]) {
    assert.equal(modelForRound(r, HAIKU, SONNET, 3), SONNET, `round ${r} should escalate`);
  }
});

test("escalation is a one-way latch — it never falls back mid-turn", () => {
  // Walk a full 12-round loop and assert the model sequence is monotone: base run, then
  // escalated run, never alternating. Oscillating would thrash the per-model prompt cache on
  // every round and make the spend ledger unreadable.
  const seq = Array.from({ length: 12 }, (_, r) => modelForRound(r, HAIKU, SONNET, 3));
  const firstEscalated = seq.indexOf(SONNET);
  assert.equal(firstEscalated, 3);
  assert.ok(
    seq.slice(firstEscalated).every((m) => m === SONNET),
    "once escalated, every later round must stay escalated"
  );
  assert.ok(
    seq.slice(0, firstEscalated).every((m) => m === HAIKU),
    "no round before the threshold may escalate"
  );
});

test("no escalation model configured → base model always (opt-in, no behaviour change)", () => {
  for (const r of [0, 3, 11]) {
    assert.equal(modelForRound(r, HAIKU, undefined, 3), HAIKU);
    assert.equal(modelForRound(r, HAIKU, "", 3), HAIKU);
  }
});

test("escalation model equal to the base is a no-op, not a pointless cache-busting switch", () => {
  assert.equal(modelForRound(9, HAIKU, HAIKU, 3), HAIKU);
});

test("after=0 escalates from the very first round", () => {
  assert.equal(modelForRound(0, HAIKU, SONNET, 0), SONNET);
});

test("a non-finite round never escalates", () => {
  // Defensive: `round >= NaN` is false, so this is the behaviour anyway — pinned so a future
  // refactor to `!(round < after)` (which flips NaN to escalate) fails here instead of in prod.
  assert.equal(modelForRound(Number.NaN, HAIKU, SONNET, 3), HAIKU);
});

test("escalateAfterRounds: unset env yields the tuned default", () => {
  assert.equal(escalateAfterRounds({} as NodeJS.ProcessEnv), DEFAULT_ESCALATE_AFTER_ROUNDS);
  assert.equal(
    escalateAfterRounds({ LARGO_ESCALATE_AFTER_ROUNDS: "   " } as NodeJS.ProcessEnv),
    DEFAULT_ESCALATE_AFTER_ROUNDS
  );
});

test("escalateAfterRounds: a valid integer overrides the default", () => {
  assert.equal(escalateAfterRounds({ LARGO_ESCALATE_AFTER_ROUNDS: "5" } as NodeJS.ProcessEnv), 5);
  assert.equal(escalateAfterRounds({ LARGO_ESCALATE_AFTER_ROUNDS: "0" } as NodeJS.ProcessEnv), 0);
});

test("escalateAfterRounds: garbage falls back to the default rather than coercing", () => {
  // "three" → NaN. If NaN reached modelForRound, `round >= NaN` is false for every round, so
  // escalation would be silently DISABLED — a capability regression with no error anywhere.
  for (const bad of ["three", "-1", "2.5", "NaN", "Infinity"]) {
    assert.equal(
      escalateAfterRounds({ LARGO_ESCALATE_AFTER_ROUNDS: bad } as NodeJS.ProcessEnv),
      DEFAULT_ESCALATE_AFTER_ROUNDS,
      `${bad} should fall back to the default`
    );
  }
});

test("didEscalate reports whether a turn actually paid for the stronger model", () => {
  // roundsUsed is a COUNT, after is a 0-based INDEX: a turn that used 4 rounds ran indices 0..3,
  // so index 3 escalated. 3 rounds (indices 0..2) did not.
  assert.equal(didEscalate(4, SONNET, 3), true);
  assert.equal(didEscalate(3, SONNET, 3), false);
  assert.equal(didEscalate(1, SONNET, 3), false);
  assert.equal(didEscalate(12, undefined, 3), false, "no escalation model → never escalated");
});
