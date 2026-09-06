import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { describeDarkPoolLevel, counterThesisLine, tradeManagerNarrativeSection } from "./play-brief-narrative";

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:NRG",
    ticker: "NRG",
    direction: "LONG",
    contract: "110C · 13DTE",
    score: 45,
    status: "HOLD",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "HOLD",
    factors: [],
    gates: [],
    ...overrides,
  };
}

function ctx(overrides: Partial<SwingPlayBriefContext> = {}): SwingPlayBriefContext {
  return {
    play: play(),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    ecosystem: null,
    vector: null,
    laneRows: [],
    meridian: null,
    ...overrides,
  };
}

test("tradeManagerNarrativeSection: narrates dark pool + dealer posture", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        maxPain: 99,
        darkPoolLevels: [{ strike: 99.5, premium: 12_000_000, pct: 42 }],
        regime: { posture: "long", label: "LONG GAMMA" },
        gexWalls: {
          callWalls: [{ strike: 105, gex: 1 }],
          putWalls: [{ strike: 97, gex: 1 }],
        },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 24,
          print_count: 15,
          call_premium: 2_100_000,
          put_premium: 800_000,
          unknown_premium: 0,
        },
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          gex_king_strike: 100,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  assert.equal(section!.title, "Trade manager read");
  assert.match(section!.body, /dark pool/i);
  assert.match(section!.body, /long gamma/i);
  assert.match(section!.body, /HELIX tape/i);
  assert.match(section!.body, /Break watch/i);
});

test("tradeManagerNarrativeSection: SHORT break watch uses stop_premium not target", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        direction: "SHORT",
        status: "HOLD",
        recommendation: "HOLD",
        exitPolicy: {
          trim_levels: [],
          stop_premium: 3.5,
          target_premium: 1.2,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Break watch.*reclaim \*\*\$4\*\*/i);
  assert.doesNotMatch(section!.body, /reclaim \*\*\$1/);
});

test("describeDarkPoolLevel: support language for long below spot", () => {
  const line = describeDarkPoolLevel({ strike: 95, premium: 5_000_000, pct: 30 }, 100, "LONG");
  assert.match(line, /Watch 95\.00/);
  assert.match(line, /support/i);
});

test("tradeManagerNarrativeSection: watch bucket entry stance", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "WATCH", recommendation: "BUY", gateBlocks: [{ code: "G1", reason: "wait" }] }),
      vector: { spot: 50 } as SwingPlayBriefContext["vector"],
    }),
    "watch",
  );
  assert.ok(section);
  assert.match(section!.body, /Entry stance/i);
});

test("tradeManagerNarrativeSection: degraded read when spot missing", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        mark: 2.45,
        pnlPct: 98,
        peak: 120,
        thesisHealth: { health: 46, rungLabel: "Degraded", pillars: [] },
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 1.96,
          target_premium: 9.8,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Hold the line/i);
  assert.match(section!.body, /Live read/i);
  assert.match(section!.body, /Manage plan/i);
  assert.match(section!.body, /Break watch/i);
});

test("counterThesisLine: steelmans bear case for LONG when desks disagree", () => {
  const line = counterThesisLine(
    ctx({
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 24,
          print_count: 10,
          call_premium: 400_000,
          put_premium: 1_200_000,
          unknown_premium: 0,
        },
        nighthawk_recent: { direction: "short", conviction: "high", outcome: "bearish" },
        zerodte_today: null,
        gex_positioning: null,
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
      vector: { spot: 100, technicals: { emaStack: "down" } } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.ok(line);
  assert.match(line!, /Counter-thesis \(bear case\)/i);
  assert.match(line!, /Night Hawk bearish/i);
  assert.match(line!, /bear EMA stack/i);
});

test("counterThesisLine: stale HELIX flow must not steelman call-led / put-led", () => {
  const line = counterThesisLine(
    ctx({
      ecosystem: {
        ticker: "INTC",
        flow_feed_fresh: false,
        recent_flow: {
          window_hours: 24,
          print_count: 10,
          call_premium: 1_200_000,
          put_premium: 400_000,
          unknown_premium: 0,
        },
        nighthawk_recent: null,
        zerodte_today: null,
        gex_positioning: null,
        arsenal: null,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "SHORT" }),
    100,
  );
  assert.equal(line, null, "stale HELIX must not appear in counter-thesis");
});

test("counterThesisLine: Vector bearish bias steelmans bear case for LONG swing", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        play: { bias: "short", headline: "Fade the rip", grade: "B" },
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.ok(line);
  assert.match(line!, /Counter-thesis \(bear case\)/i);
  assert.match(line!, /Vector bearish/i);
  assert.match(line!, /Fade the rip/i);
});

test("tradeManagerNarrativeSection: includes counter-thesis when opposing signals exist", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: { spot: 100, regime: { posture: "long", label: "LONG GAMMA" } } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 24,
          print_count: 8,
          call_premium: 300_000,
          put_premium: 900_000,
          unknown_premium: 0,
        },
        nighthawk_recent: { direction: "short", conviction: "medium", outcome: "bearish" },
        zerodte_today: null,
        gex_positioning: { gamma_posture: "long" },
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Counter-thesis/i);
});
