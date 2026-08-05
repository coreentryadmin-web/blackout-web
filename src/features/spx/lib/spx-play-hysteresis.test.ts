import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDecisionHysteresis,
  applySpxPlayDisplayHysteresis,
  resetSpxPlayHysteresisForTests,
  type HysteresisDecision,
  type HysteresisState,
} from "./spx-play-hysteresis";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";

const START = 1_000_000_000; // arbitrary epoch ms

function step(
  state: HysteresisState | null,
  decision: HysteresisDecision,
  nowMs: number
): { state: HysteresisState; decision: HysteresisDecision } {
  return applyDecisionHysteresis(state, decision, nowMs);
}

test("applyDecisionHysteresis: first observation is accepted immediately", () => {
  const { state, decision } = step(null, { action: "SCANNING", direction: null }, START);
  assert.deepEqual(decision, { action: "SCANNING", direction: null });
  assert.deepEqual(state.displayed, { action: "SCANNING", direction: null });
  assert.equal(state.pending, null);
});

test("applyDecisionHysteresis: upgrades (SCANNING->WATCHING->BUY) apply with zero lag", () => {
  let s: HysteresisState | null = null;
  let r = step(s, { action: "SCANNING", direction: null }, START);
  s = r.state;
  r = step(s, { action: "WATCHING", direction: "long" }, START + 2_000);
  assert.deepEqual(r.decision, { action: "WATCHING", direction: "long" });
  s = r.state;
  r = step(s, { action: "BUY", direction: "long" }, START + 4_000);
  assert.deepEqual(r.decision, { action: "BUY", direction: "long" });
});

test("applyDecisionHysteresis: a single noisy downgrade poll does NOT flip the display", () => {
  let s: HysteresisState | null = null;
  let r = step(s, { action: "BUY", direction: "long" }, START);
  s = r.state;

  // One noisy poll 2s later proposes a downgrade to WATCHING.
  r = step(s, { action: "WATCHING", direction: "long" }, START + 2_000);
  assert.deepEqual(r.decision, { action: "BUY", direction: "long" }, "still shows BUY");
  s = r.state;

  // Next poll bounces back up to BUY (classic threshold wobble) — should read as "unchanged",
  // clearing the pending downgrade entirely.
  r = step(s, { action: "BUY", direction: "long" }, START + 4_000);
  assert.deepEqual(r.decision, { action: "BUY", direction: "long" });
  assert.equal(r.state.pending, null);
});

test("applyDecisionHysteresis: rapid oscillation around a threshold never confirms a swap", () => {
  // Simulate a score wobbling across the WATCHING/BUY boundary every poll for 20 polls (40s) —
  // since it never repeats the SAME downgraded decision twice in a row, it should never confirm.
  let s: HysteresisState | null = null;
  let r = step(s, { action: "BUY", direction: "long" }, START);
  s = r.state;
  let now = START;
  for (let i = 0; i < 20; i++) {
    now += 2_000;
    const proposal: HysteresisDecision =
      i % 2 === 0
        ? { action: "WATCHING", direction: "long" }
        : { action: "BUY", direction: "long" };
    r = step(s, proposal, now);
    s = r.state;
  }
  assert.deepEqual(r.decision, { action: "BUY", direction: "long" }, "never flickered away from BUY");
});

test("applyDecisionHysteresis: a genuine sustained downgrade confirms via the streak floor", () => {
  let s: HysteresisState | null = null;
  let r = step(s, { action: "BUY", direction: "long" }, START);
  s = r.state;

  // Same downgrade proposed on 4 consecutive polls (2s apart) — should confirm on the 4th.
  for (let i = 1; i <= 3; i++) {
    r = step(s, { action: "SCANNING", direction: null }, START + i * 2_000);
    assert.deepEqual(r.decision, { action: "BUY", direction: "long" }, `poll ${i} still holds`);
    s = r.state;
  }
  r = step(s, { action: "SCANNING", direction: null }, START + 4 * 2_000);
  assert.deepEqual(r.decision, { action: "SCANNING", direction: null }, "confirmed on 4th consecutive poll");
});

test("applyDecisionHysteresis: a genuine sustained downgrade confirms via the dwell-time floor", () => {
  let s: HysteresisState | null = null;
  let r = step(s, { action: "BUY", direction: "long" }, START);
  s = r.state;

  // Only 2 polls, but 9s apart — should confirm on elapsed time even without 4 polls.
  r = step(s, { action: "SCANNING", direction: null }, START + 1_000);
  assert.deepEqual(r.decision, { action: "BUY", direction: "long" });
  s = r.state;
  r = step(s, { action: "SCANNING", direction: null }, START + 9_000);
  assert.deepEqual(r.decision, { action: "SCANNING", direction: null }, "confirmed by dwell time");
});

test("applyDecisionHysteresis: direction flip at the same rank (BUY long -> BUY short) also dwells", () => {
  let s: HysteresisState | null = null;
  let r = step(s, { action: "BUY", direction: "long" }, START);
  s = r.state;

  r = step(s, { action: "BUY", direction: "short" }, START + 2_000);
  assert.deepEqual(r.decision, { action: "BUY", direction: "long" }, "does not swap symbol/direction on one poll");
  s = r.state;

  r = step(s, { action: "BUY", direction: "short" }, START + 4_000);
  s = r.state;
  r = step(s, { action: "BUY", direction: "short" }, START + 6_000);
  assert.deepEqual(r.decision, { action: "BUY", direction: "long" }, "still not confirmed (3 polls)");
});

test("applyDecisionHysteresis: repeating the currently-displayed decision is a no-op, not a dwell candidate", () => {
  let s: HysteresisState | null = null;
  let r = step(s, { action: "WATCHING", direction: "long" }, START);
  s = r.state;
  r = step(s, { action: "WATCHING", direction: "long" }, START + 2_000);
  assert.deepEqual(r.decision, { action: "WATCHING", direction: "long" });
  assert.equal(r.state.pending, null);
});

// ---------------------------------------------------------------------------
// applySpxPlayDisplayHysteresis — the payload-level wrapper actually wired into
// getSpxPlaySnapshot (spx-play-engine.ts).
// ---------------------------------------------------------------------------

function payload(overrides: Partial<SpxPlayPayload>): SpxPlayPayload {
  return {
    available: true,
    phase: "SCANNING",
    action: "SCANNING",
    direction: null,
    grade: "C",
    score: 0,
    confidence: 0,
    headline: "idle",
    thesis: "idle",
    idle_message: null,
    factors: [],
    levels: { entry: null, stop: null, target: null, invalidation: "" },
    gates: {
      passed: false,
      blocks: [],
      blocks_by_category: {} as SpxPlayPayload["gates"]["blocks_by_category"],
      first_block_category: null,
      warnings: [],
      entry_mode: "none",
      play_idea: null,
    },
    claude: null,
    cortex: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: null,
    telemetry: null,
    lotto_play: null,
    power_play: null,
    session_phase: "cash",
    signal_committed: false,
    as_of: new Date(START).toISOString(),
    ...overrides,
  } as SpxPlayPayload;
}

test("applySpxPlayDisplayHysteresis: freezes headline/score together, not just action", () => {
  resetSpxPlayHysteresisForTests();
  const day = "2026-08-05";

  const buy = payload({
    action: "BUY",
    direction: "long",
    score: 82,
    headline: "A+ CALL — buy",
  });
  const first = applySpxPlayDisplayHysteresis(buy, day, START);
  assert.equal(first.action, "BUY");

  // A noisy poll 2s later proposes SCANNING with a different score/headline — must be fully
  // suppressed (not just the action field) so headline/score/direction stay internally coherent.
  const noisyScan = payload({
    action: "SCANNING",
    direction: null,
    score: 41,
    headline: "Quality bar not met",
    as_of: new Date(START + 2_000).toISOString(),
  });
  const second = applySpxPlayDisplayHysteresis(noisyScan, day, START + 2_000);
  assert.equal(second.action, "BUY", "action held");
  assert.equal(second.score, 82, "score held together with the action — no Frankenstein payload");
  assert.equal(second.headline, "A+ CALL — buy");
  // as_of still refreshes so the card doesn't look frozen/stale.
  assert.equal(second.as_of, new Date(START + 2_000).toISOString());
});

test("applySpxPlayDisplayHysteresis: an open position always passes through untouched", () => {
  resetSpxPlayHysteresisForTests();
  const day = "2026-08-05";

  const buy = payload({ action: "BUY", direction: "long", score: 82 });
  applySpxPlayDisplayHysteresis(buy, day, START);

  const open = payload({
    action: "HOLD",
    direction: "long",
    open_play: {
      id: "1",
      direction: "long",
      entry_price: 100,
      stop: 95,
      target: 110,
      grade: "A",
      opened_at: new Date(START).toISOString(),
      mfe_pts: 0,
      trim_done: false,
      option_label: null,
      option_premium: null,
      option_pnl_est: null,
    },
  });
  const result = applySpxPlayDisplayHysteresis(open, day, START + 2_000);
  assert.equal(result, open, "open-position payloads bypass the sticky layer entirely");
});

test("applySpxPlayDisplayHysteresis: genuine sustained downgrade eventually reaches the card", () => {
  resetSpxPlayHysteresisForTests();
  const day = "2026-08-05";

  applySpxPlayDisplayHysteresis(payload({ action: "BUY", direction: "long", score: 82 }), day, START);

  let last: SpxPlayPayload | null = null;
  for (let i = 1; i <= 4; i++) {
    last = applySpxPlayDisplayHysteresis(
      payload({ action: "SCANNING", direction: null, score: 30, headline: "flat" }),
      day,
      START + i * 2_000
    );
  }
  assert.equal(last!.action, "SCANNING", "confirmed downgrade eventually surfaces");
  assert.equal(last!.score, 30);
});

test("applySpxPlayDisplayHysteresis: a new session date resets dwell state", () => {
  resetSpxPlayHysteresisForTests();
  applySpxPlayDisplayHysteresis(payload({ action: "BUY", direction: "long" }), "2026-08-05", START);
  const nextDay = applySpxPlayDisplayHysteresis(
    payload({ action: "SCANNING", direction: null, score: 10 }),
    "2026-08-06",
    START + 1_000
  );
  assert.equal(nextDay.action, "SCANNING", "first observation of a new session is accepted immediately");
});
