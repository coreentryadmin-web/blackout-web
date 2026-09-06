import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { describeDarkPoolLevel, tradeManagerNarrativeSection } from "./play-brief-narrative";

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
