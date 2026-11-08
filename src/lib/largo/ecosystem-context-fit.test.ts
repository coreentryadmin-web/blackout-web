import assert from "node:assert/strict";
import { test } from "node:test";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import { fitEcosystemContextForModel } from "@/lib/largo/ecosystem-context-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";
import { MAX_TOOL_RESULT_CHARS } from "@/lib/providers/anthropic";
import { fitVectorFullStateForModel } from "@/lib/bie/vector-full-state-fit";
import { VECTOR_FULL_STATE_FIXTURE } from "@/lib/bie/vector-full-state-fixture";

function baseContext(): EcosystemContext {
  return {
    ticker: "SPX",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    flow_full_state: null,
    recent_anomalies: [],
    spx_play: null,
    spx_full_state: null,
    spx_desk_convergence: null,
    flow_feed_fresh: true,
    gex_positioning: null,
    vector_full_state: null,
    arsenal: {
      scope: "index",
      earnings: null,
      fundamentals: null,
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  };
}

test("fitEcosystemContextForModel caps audit rows and reports truncation", () => {
  const raw = baseContext();
  raw.recent_audit_entries = Array.from({ length: 12 }, (_, i) => ({
    alert_type: "zerodte",
    fired_at: `2026-09-03T10:0${i}:00.000Z`,
    confidence_label: "A",
    trigger_reason: "test",
    outcome: null,
  }));

  const { fitted } = fitEcosystemContextForModel(raw);
  assert.equal(fitted.recent_audit_entries.length, 5);
  assert.equal(fitted.recent_audit_entries_total, 12);
  assert.equal(fitted.recent_audit_entries_truncated, true);
});

test("fitEcosystemContextForModel stays under Largo char budget for heavy SPX flow tape", () => {
  const raw = baseContext();
  raw.flow_full_state = {
    count: 200,
    total_premium: 9_000_000,
    top_tickers: [],
    strike_stacks: [],
    recent: Array.from({ length: 120 }, (_, i) => ({
      ticker: "SPX",
      premium: 50_000 + i,
      option_type: "CALL",
      strike: 5900 + i,
      expiry: "2026-09-05",
      direction: "bullish",
      score: 70,
      route: "sweep",
      alerted_at: "2026-09-03T14:00:00.000Z",
    })),
  };

  const { fitted } = fitEcosystemContextForModel(raw);
  assert.ok(fitted.flow_full_state!.recent.length <= 25);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});

/**
 * One realistic ORACLE bead — copied from `vector-full-state-fit.test.ts`'s own fixture (20 wall
 * levels per side on BOTH lenses, each carrying `notional`) because that is what a real Vector
 * rail bead actually serializes to (~4k chars), not a toy stub.
 */
function oracleBead(time: number) {
  const side = (offset: number) =>
    Array.from({ length: 20 }, (_, i) => ({
      strike: 7600 + (i + offset) * 5,
      pct: Number((12.34 - i * 0.4).toFixed(2)),
      notional: 1_234_567_890 - i * 7_654_321,
    }));
  return {
    time,
    walls: { callWalls: side(0), putWalls: side(-20) },
    gammaFlip: 7655.25,
    vexWalls: { callWalls: side(0), putWalls: side(-20) },
    vexFlip: 7640.5,
  };
}

/** Oversized `spx_full_state` — copied from `spx-play-fit.test.ts`'s own fixture. */
function oversizedSpxFullState(): Record<string, unknown> {
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
    telemetry: {
      adaptive_active: true,
      summary: "t".repeat(300),
      cold_buy_win_rate: 0.4,
      promote_win_rate: 0.5,
      global_score_boost: 0,
      promote_score_boost: 0,
      total_closed: 40,
    },
    lotto_play: null,
    power_play: null,
    session_phase: "cash",
    signal_committed: false,
    assessed: true,
    playbook_shadow: { matches: Array.from({ length: 6 }, (_, i) => ({ id: i })) },
    desk_context: { note: "d".repeat(300) },
    as_of: "2026-09-03T14:00:00.000Z",
  };
}

/** A realistic `FlowTapeSummary`-shaped `flow_full_state` carrying 120 real-shaped prints. */
function heavyFlowFullState() {
  return {
    count: 200,
    total_premium: 9_000_000,
    top_tickers: [],
    strike_stacks: [],
    recent: Array.from({ length: 120 }, (_, i) => ({
      ticker: "SPX",
      premium: 50_000 + i,
      option_type: "CALL",
      strike: 5900 + i,
      expiry: "2026-09-05",
      direction: "bullish",
      score: 70,
      route: "sweep",
      alerted_at: "2026-09-03T14:00:00.000Z",
    })),
  };
}

test("fitEcosystemContextForModel: combined heavy vector_full_state + flow_full_state + spx_full_state stays under the REAL transport cap", () => {
  // `vector_full_state` arrives ALREADY FIT by `fetchEcosystemContext` (it calls
  // `fitVectorFullStateForModel(vectorFullState)` with no budget override before this function
  // ever sees the result) — so build the fixture the same way production does: a real rail, then
  // one pass through the real fitter, exactly like `fetchEcosystemContext` performs.
  const bigRailState = {
    ...VECTOR_FULL_STATE_FIXTURE,
    unavailable_sections: [] as string[],
    wall_history_empty_reason: null,
    observed_at: "2026-07-13T14:40:00.000Z",
    observed_session_date: "2026-07-13",
    as_of: "2026-07-13 10:41 ET",
    session_date: "2026-07-13",
    age_seconds: 60,
    freshness: "live",
    note: null,
    wallHistory: Array.from({ length: 60 }, (_, i) => oracleBead(1_752_417_300 + i * 5)),
  };
  const preFitVector = fitVectorFullStateForModel(bigRailState);

  const raw = baseContext();
  raw.vector_full_state = preFitVector as unknown as EcosystemContext["vector_full_state"];
  raw.flow_full_state = heavyFlowFullState();
  raw.spx_full_state = oversizedSpxFullState() as unknown as EcosystemContext["spx_full_state"];

  const { fitted } = fitEcosystemContextForModel(raw);
  const chars = JSON.stringify(fitted).length;
  assert.ok(
    chars <= MAX_TOOL_RESULT_CHARS,
    `fitted ecosystem context ${chars} chars must fit the real ${MAX_TOOL_RESULT_CHARS}-char transport cap ` +
      `even with a heavy vector rail, flow tape, and SPX play all populated together — each field ` +
      `fitting its OWN full budget in isolation is not sufficient when they are combined`
  );
});
