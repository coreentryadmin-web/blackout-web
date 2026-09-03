import assert from "node:assert/strict";
import { test } from "node:test";
import { fitSpxPlayForModel } from "@/lib/largo/spx-play-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

function oversizedPlay() {
  return {
    available: true,
    phase: "WATCHING",
    action: "WATCHING",
    direction: "long",
    grade: "B",
    score: 72,
    rawScore: 72,
    headline: "x".repeat(500),
    thesis: "y".repeat(800),
    idle_message: null,
    factors: Array.from({ length: 40 }, (_, i) => ({
      label: `factor-${i}`,
      weight: 5,
      detail: "z".repeat(400),
    })),
    levels: { entry: 5900, stop: 5880, target: 5950, invalidation: "below 5880" },
    gates: {
      passed: false,
      blocks: Array.from({ length: 14 }, (_, i) => `Block ${i}: ${"w".repeat(80)}`),
      warnings: [],
      entry_mode: "full",
      play_idea: null,
    },
    claude: null,
    cortex: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: { summary: "x".repeat(400) },
    option_ticket: { label: "CALL 5900", premium: 12.5 },
    watch: null,
    telemetry: { adaptive_active: true, summary: "t".repeat(300), cold_buy_win_rate: 0.4, promote_win_rate: 0.5, global_score_boost: 0, promote_score_boost: 0, total_closed: 40 },
    lotto_play: null,
    power_play: null,
    session_phase: "cash",
    signal_committed: false,
    assessed: true,
    playbook_shadow: { matches: Array.from({ length: 6 }, (_, i) => ({ id: i })) },
    desk_context: { note: "d".repeat(300) },
    as_of: "2026-09-03T14:00:00.000Z",
  } as Record<string, unknown>;
}

const size = (o: unknown) => JSON.stringify(o).length;

test("oversized play fixture exceeds Largo budget", () => {
  assert.ok(size(oversizedPlay()) > LARGO_RESULT_CHAR_BUDGET);
});

test("fitSpxPlayForModel fits under budget and preserves scalars", () => {
  const { fitted, chars } = fitSpxPlayForModel(oversizedPlay());
  assert.ok(chars <= LARGO_RESULT_CHAR_BUDGET, `${chars} chars over budget`);
  assert.equal(fitted.phase, "WATCHING");
  assert.equal(fitted.score, 72);
  assert.ok(fitted.factors.length <= 12);
  const notes = fitted.sample_notes as Record<string, string>;
  assert.match(notes.factors ?? "", /of 40/);
});
