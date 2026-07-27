import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nighthawkPhaseFor,
  nighthawkToSignals,
  sortSignals,
  spxPhaseFor,
  spxToSignal,
} from "./signals-projection";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import type { NightHawkEdition, PlaybookPlay } from "@/features/nighthawk/lib/types";

/**
 * These tests protect the iOS Signals tab from silent contract drift. The
 * app's SignalLifecycle enum ships in a compiled binary — a mislabelled
 * phase reaches production before the wire failure would.
 */

function makeSpx(overrides: Partial<SpxPlayPayload> = {}): SpxPlayPayload {
  return {
    available: true,
    phase: "SCANNING",
    action: "SCANNING",
    direction: null,
    grade: "D",
    score: 0,
    confidence: 0,
    headline: "",
    thesis: "",
    idle_message: null,
    factors: [],
    levels: { entry: null, stop: null, target: null, invalidation: "" },
    gates: {
      passed: false,
      blocks: [],
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
    as_of: "2026-07-27T14:30:00Z",
    ...overrides,
  } as SpxPlayPayload;
}

function makePlay(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "NVDA",
    direction: "LONG",
    conviction: "A",
    play_type: "stock",
    thesis: "Sustained call flow across earnings week.",
    key_signal: "5-day call flow streak",
    entry_range: "$500-503",
    target: "$515",
    stop: "$495",
    options_play: "500C 30D",
    score: 82,
    flow_streak_days: 5,
    iv_rank: 42,
    ...overrides,
  };
}

function makeEdition(overrides: Partial<NightHawkEdition> = {}): NightHawkEdition {
  return {
    available: true,
    edition_for: "2026-07-28",
    published_at: "2026-07-27T20:15:00Z",
    recap_headline: null,
    recap_summary: null,
    plays: [makePlay()],
    ...overrides,
  };
}

test("spxPhaseFor maps engine phases to lifecycle stages", () => {
  assert.equal(spxPhaseFor(makeSpx({ phase: "SCANNING", open_play: null })), "detected");
  assert.equal(spxPhaseFor(makeSpx({ phase: "WATCHING", open_play: null })), "confirming");
  assert.equal(spxPhaseFor(makeSpx({ phase: "OPEN", open_play: null })), "active");
  // open_play overrides phase — a live position is ALWAYS active regardless
  // of the phase string that ran the evaluator that emitted it.
  assert.equal(
    spxPhaseFor(
      makeSpx({
        phase: "SCANNING",
        open_play: {
          id: 1,
          direction: "long",
          entry_price: 7500,
          stop: 7490,
          target: 7520,
          grade: "A",
          opened_at: "",
          mfe_pts: 0,
          trim_done: false,
        },
      })
    ),
    "active"
  );
});

test("nighthawkPhaseFor: pulled → invalidated, stale → detected, else active", () => {
  assert.equal(nighthawkPhaseFor(makePlay(), false), "active");
  assert.equal(nighthawkPhaseFor(makePlay(), true), "detected");
  assert.equal(nighthawkPhaseFor(makePlay({ pulled: true }), false), "invalidated");
  // Pulled + stale → still invalidated (invalidation is the more specific,
  // more actionable label; stale is just "edition age").
  assert.equal(nighthawkPhaseFor(makePlay({ pulled: true }), true), "invalidated");
});

test("spxToSignal projects live levels + factor labels + prefers open_play levels", () => {
  const s = spxToSignal(
    makeSpx({
      phase: "OPEN",
      action: "BUY",
      direction: "long",
      grade: "A+",
      score: 91,
      confidence: 0.72,
      headline: "SPX long — VWAP reclaim",
      thesis: "Reclaimed VWAP with flow confirmation.",
      levels: { entry: 7500, stop: 7488, target: 7520, invalidation: "3m close < VWAP" },
      factors: [
        { label: "Above VWAP", weight: 1, detail: "" },
        { label: "Positive GEX", weight: 1, detail: "" },
      ],
      open_play: {
        id: 42,
        direction: "long",
        entry_price: 7501,
        stop: 7489,
        target: 7522,
        grade: "A+",
        opened_at: "",
        mfe_pts: 3,
        trim_done: false,
      },
    })
  );
  assert.ok(s);
  assert.equal(s!.id, "spx-open-42");
  assert.equal(s!.phase, "active");
  assert.equal(s!.grade, "A+");
  assert.equal(s!.entry, 7501); // open_play wins over levels
  assert.equal(s!.stop, 7489);
  assert.equal(s!.target, 7522);
  assert.deepEqual(s!.factors, ["Above VWAP", "Positive GEX"]);
});

test("spxToSignal returns null for a scanning idle desk with no message", () => {
  const s = spxToSignal(makeSpx({ available: false, phase: "SCANNING", headline: "", thesis: "" }));
  assert.equal(s, null);
});

test("nighthawkToSignals stamps every play, marks PULLED as invalidated with reason", () => {
  const ed = makeEdition({
    plays: [
      makePlay({ rank: 1, ticker: "NVDA" }),
      makePlay({
        rank: 2,
        ticker: "TSLA",
        pulled: true,
        pulled_reason: "Overnight gap invalidates entry.",
      }),
    ],
  });
  const out = nighthawkToSignals(ed);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "nh-2026-07-28-1-NVDA");
  assert.equal(out[0].phase, "active");
  assert.equal(out[0].action, "OPEN");
  assert.equal(out[1].phase, "invalidated");
  assert.equal(out[1].action, "PULLED");
  assert.equal(out[1].meta.pulledReason, "Overnight gap invalidates entry.");
});

test("nighthawkToSignals returns [] for empty edition — never fabricates a phantom entry", () => {
  assert.deepEqual(nighthawkToSignals(makeEdition({ available: false, plays: [] })), []);
  assert.deepEqual(nighthawkToSignals(makeEdition({ available: true, plays: [] })), []);
});

test("sortSignals orders active > confirming > detected > invalidated, higher score wins within a stage", () => {
  const now = "2026-07-27T14:30:00Z";
  const s = (phase: "active" | "confirming" | "detected" | "invalidated", score: number, id: string) =>
    ({
      id,
      source: "SPX_SLAYER" as const,
      ticker: "SPX",
      direction: "long",
      action: "BUY",
      grade: "A",
      score,
      confidence: 0.5,
      phase,
      headline: "",
      thesis: "",
      entry: null,
      stop: null,
      target: null,
      invalidation: null,
      factors: [],
      asOf: now,
      meta: {},
    });
  const out = sortSignals([
    s("invalidated", 80, "x"),
    s("detected", 60, "a"),
    s("active", 40, "b"),
    s("confirming", 90, "c"),
    s("active", 95, "d"),
  ]);
  assert.deepEqual(
    out.map((x) => x.id),
    ["d", "b", "c", "a", "x"]
  );
});
