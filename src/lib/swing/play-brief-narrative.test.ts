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

test("tradeManagerNarrativeSection: stale Vector snapshot does not say Right now (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        dataAgeMs: 180_000,
        freshness: "stale",
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /180s old/i);
  assert.doesNotMatch(section!.body, /Right now/i);
});

test("tradeManagerNarrativeSection: stale GEX-only matrix does not narrate dealer posture (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: { spot: 100 } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          matrix_age_sec: 180,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /dealer gamma posture not resolved/i);
  assert.doesNotMatch(section!.body, /long gamma/i);
  assert.doesNotMatch(section!.body, /γ-flip/i);
  assert.doesNotMatch(section!.body, /Right now/i);
});

test("tradeManagerNarrativeSection: stale GEX-only put wall must not drive Break watch (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          put_wall: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Break watch.*98\.00/i, "stale GEX put wall must not anchor break trigger");
});

test("tradeManagerNarrativeSection: stale GEX-only gamma flip must not appear in dealer posture line (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          flip: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Right now/i, "live Vector posture must not be relabeled stale");
  assert.match(section!.body, /long gamma/i);
  assert.doesNotMatch(
    section!.body,
    /γ-flip/i,
    "stale GEX-only flip must not qualify a live-posture dealer read",
  );
});

test("tradeManagerNarrativeSection: live Vector gamma flip still shown when GEX matrix is stale", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 97,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          flip: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /γ-flip \*\*97\.00\*\*/i, "live Vector flip must still render");
});

test("tradeManagerNarrativeSection: stale GEX-only gamma flip must not drive Break watch (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          flip: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Break watch.*98\.00/i, "stale GEX flip must not anchor break trigger");
});

test("tradeManagerNarrativeSection: live Vector put wall still drives Break watch when GEX matrix is stale", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gexWalls: { putWalls: [{ strike: 97 }], callWalls: [] },
      } as unknown as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          put_wall: 95,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Break watch.*97\.00/i, "live Vector wall must still anchor break trigger");
});

test("tradeManagerNarrativeSection: stale GEX-only gamma posture must not drive GEX king narration (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        ladder: { rows: [{ strike: 103, isKing: true }] },
      } as unknown as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          gamma_posture: "long",
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /GEX king 103\.00/i);
  assert.doesNotMatch(
    section!.body,
    /Pin risk/i,
    "stale GEX-only gamma posture must not drive the king strike's directional pin/acceleration call",
  );
  assert.match(section!.body, /Max-gamma node/i, "falls back to the posture-unknown narration");
});

test("tradeManagerNarrativeSection: live Vector gamma posture still drives GEX king narration despite stale GEX matrix", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        ladder: { rows: [{ strike: 103, isKing: true }] },
        regime: { posture: "long" },
      } as unknown as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          gamma_posture: "short",
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Pin risk/i, "live Vector posture must still drive the directional call");
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

test("tradeManagerNarrativeSection: bias reads bullish from technicals on SHORT play with bullish tape (FINDINGS 2026-09-06 #13 parity)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "SHORT", status: "HOLD" }),
      vector: {
        spot: 95,
        technicals: {
          vwap: 94.7,
          emaStack: "up",
          rsi: 67,
          macd: "bull",
          goldenPocket: null,
          structure: { type: "CHOCH", direction: "up", level: 94 },
        },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );
  assert.ok(section);
  assert.equal(section!.bias, "bullish");
});

test("tradeManagerNarrativeSection: bias reads bearish from technicals on LONG play with bearish tape (FINDINGS 2026-09-06 #13 parity)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG", status: "HOLD" }),
      vector: {
        spot: 15,
        technicals: {
          vwap: 15.29,
          emaStack: "down",
          rsi: 40,
          macd: "bear",
          goldenPocket: null,
          structure: { type: "BOS", direction: "down", level: 15.5 },
        },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );
  assert.ok(section);
  assert.equal(section!.bias, "bearish");
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

test("counterThesisLine: stale GEX-only posture must not steelman dealer gamma", () => {
  const line = counterThesisLine(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          gamma_posture: "long",
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.equal(line, null, "stale GEX posture must not appear in counter-thesis");
});

test("counterThesisLine: stale GEX-only call wall must not steelman overhead resistance (Largo C2)", () => {
  const line = counterThesisLine(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          call_wall: 102,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.equal(line, null, "stale GEX call wall must not appear in counter-thesis");
});

test("counterThesisLine: stale GEX-only put wall must not steelman support break (Largo C2)", () => {
  const line = counterThesisLine(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          put_wall: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "SHORT" }),
    100,
  );
  assert.equal(line, null, "stale GEX put wall must not appear in counter-thesis");
});

test("counterThesisLine: live Vector call wall still steelmans even when GEX matrix is stale (per-wall gate)", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        gexWalls: { callWalls: [{ strike: 101 }], putWalls: [] },
      } as unknown as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          call_wall: 102,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.ok(line, "a live Vector wall must still steelman even when the GEX matrix is stale");
  assert.match(line!, /call wall/i);
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

test("counterThesisLine: stale Vector play bias must not steelman desk read (Largo C2)", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        play: { bias: "short", headline: "Fade the rip", grade: "B" },
        freshness: "stale",
        dataAgeMs: 180_000,
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.equal(line, null, "stale Vector play bias must not appear in counter-thesis");
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

test("tradeManagerNarrativeSection: Break watch + Counter-thesis survive MAX_BULLETS on rich Vector data", () => {
  const richVector = {
    spot: 100,
    gammaFlip: 98.5,
    maxPain: 99,
    vexFlip: 99.2,
    vexWalls: { callWalls: [{ strike: 104, gex: 1 }], putWalls: [{ strike: 96, gex: 1 }] },
    darkPoolLevels: [{ strike: 99.5, premium: 12_000_000, pct: 42 }],
    regime: { posture: "long", label: "LONG GAMMA" },
    gexWalls: { callWalls: [{ strike: 105, gex: 1 }], putWalls: [{ strike: 97, gex: 1 }] },
    proximity: { strike: 105, side: "call", callout: "within 2% of call wall" },
    wallEvents: [{ kind: "call_wall_shift", message: "call wall lifted to 105" }],
    magnet: { strike: 100, distancePct: 0.3, pull: "at" },
    confluenceZones: [{ center: 101, score: 8, kinds: ["gex", "dark_pool"] }],
    expectedMove: { pct: 4.2, upper: 104.2, lower: 95.8 },
    technicals: { emaStack: "up", macd: "bull", vwapSide: "above", structure: "BOS up" },
  } as SwingPlayBriefContext["vector"];

  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        score: 52,
        pnlPct: 18,
        peak: 32,
        manageAction: "HOLD",
        thesisHealth: {
          health: 48,
          rungLabel: "Degraded",
          advisory: "Tighten risk",
          pillars: [
            {
              id: "market",
              label: "Regime fit",
              status: "faded",
              commitLabel: "aligned",
              currentLabel: "neutral",
              deltaPts: -12,
            },
          ],
          moves: ["flow cooled vs open"],
        },
        exitPolicy: {
          trim_levels: [
            { trigger_pct: 25, fired: true },
            { trigger_pct: 50, fired: false },
          ],
          stop_premium: 1.85,
          target_premium: 4.2,
          time_stop_et: "15:45",
          runner_fraction: 0.25,
        },
      }),
      vector: richVector,
      laneRows: [
        { ticker: "NRG", direction: "LONG", horizon: "SWING", score: 52, status: "COMMIT", contract: {} as never, scoreFloor: 40, reason: "momentum" },
        { ticker: "INTC", direction: "LONG", horizon: "SWING", score: 61, status: "COMMIT", contract: {} as never, scoreFloor: 40, reason: "flow" },
        { ticker: "MU", direction: "LONG", horizon: "SWING", score: 44, status: "COMMIT", contract: {} as never, scoreFloor: 40, reason: "breakout" },
      ],
      meridian: {
        items: [{ kind: "earnings", days_until: 5, ticker: "NRG", importance: 4 }],
      } as SwingPlayBriefContext["meridian"],
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 24,
          print_count: 22,
          call_premium: 350_000,
          put_premium: 1_100_000,
          unknown_premium: 0,
        },
        nighthawk_recent: { direction: "short", conviction: "high", outcome: "bearish" },
        zerodte_today: { direction: "long", conviction: "medium" },
        gex_positioning: {
          spot: 100,
          flip: 98.5,
          gamma_posture: "long",
          gex_king_strike: 100,
        },
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  const bulletCount = section!.body.split("\n").filter((l) => l.startsWith("• ")).length;
  assert.ok(bulletCount > 14, `expected >14 coaching bullets to stress the cap, got ${bulletCount}`);
  assert.match(section!.body, /Break watch/i, "safety-critical break coaching must not starve");
  assert.match(section!.body, /Counter-thesis/i, "counter-thesis must not starve behind MAX_BULLETS");
});
