import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import {
  bookContextCoaching,
  catalystCoaching,
  closedCoaching,
  crossDeskCoaching,
  execSlippageCoaching,
  manageLifecycleCoaching,
  thesisBreakCoaching,
  thesisPillarCoaching,
  vectorPlayCoaching,
  vexCoaching,
  watchGateCoaching,
} from "./play-brief-narrative-coaching";

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

test("thesisBreakCoaching: break level is urgent", () => {
  const line = thesisBreakCoaching(
    play({ thesisBreak: { level: "break", note: "persistence lost" } }),
  );
  assert.match(line!, /Thesis BREAK/i);
  assert.match(line!, /persistence lost/i);
});

test("thesisPillarCoaching: names fading pillar", () => {
  const line = thesisPillarCoaching(
    play({
      thesisHealth: {
        health: 42,
        entryIndex: 70,
        currentIndex: 42,
        delta: -28,
        rung: "DEGRADED",
        rungLabel: "Degraded",
        advisory: "Tighten risk.",
        moves: [],
        committedAtEt: null,
        computedAtEt: "20:00",
        thesisBreakLevel: "warn",
        thesisBreakNote: "fade",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.3,
            commitScore: 0.9,
            currentScore: 0.3,
            commitLabel: "mature",
            currentLabel: "fading",
            status: "faded",
            contributionPts: 9,
            deltaPts: -18,
          },
        ],
      },
    }),
  );
  assert.match(line!, /Pillar fade/i);
  assert.match(line!, /Persistence/i);
});

test("manageLifecycleCoaching: trim ladder + time stop", () => {
  const line = manageLifecycleCoaching(
    play({
      manageAction: "TAKE_PARTIAL",
      exitPolicy: {
        trim_levels: [
          { trigger_pct: 50, fired: true },
          { trigger_pct: 100, fired: false },
        ],
        stop_premium: 1.5,
        target_premium: 5,
        time_stop_et: "15:50",
        runner_fraction: 0.25,
      },
    }),
    "open",
  );
  assert.match(line!, /1\/2 trims banked/i);
  assert.match(line!, /15:50 ET/i);
  assert.match(line!, /25% runner/i);
});

test("watchGateCoaching: includes reasons", () => {
  const line = watchGateCoaching(
    play({
      status: "WATCH",
      gateBlocks: [{ code: "G1", reason: "wait for trigger" }],
    }),
  );
  assert.match(line!, /wait for trigger/i);
});

test("crossDeskCoaching: friction when NH conflicts", () => {
  const line = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "NRG",
        nighthawk_recent: {
          edition_for: "NRG",
          direction: "short",
          conviction: "high",
          outcome: "bearish",
          score: 80,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play(),
  );
  assert.match(line!, /Cross-desk friction/i);
  assert.match(line!, /Night Hawk bearish/i);
});

test("catalystCoaching: earnings within 14d", () => {
  const line = catalystCoaching(
    ctx({
      ecosystem: {
        ticker: "NRG",
        arsenal: {
          earnings: { days_until: 5, earnings_date: "2026-09-10" },
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
  );
  assert.match(line!, /Earnings in 5d/i);
});

test("closedCoaching: MFE capture lesson", () => {
  const line = closedCoaching(
    play({
      status: "CLOSED",
      peak: 80,
      exitPnlPct: 20,
      mfeCapturePct: 25,
      closedReason: "thesis",
    }),
  );
  assert.match(line!, /Gave back the move/i);
  assert.match(line!, /thesis break/i);
});

test("closedCoaching: a round-trip past breakeven never renders a nonsensical negative MFE capture", () => {
  // Reproduces a live production case: INTC:35 peak +25.7%, exited -40.8% used to render
  // "only -158.9% MFE capture" (exitPnlPct / peak * 100), a percentage with no honest reading.
  const line = closedCoaching(
    play({
      status: "CLOSED",
      peak: 25.7,
      exitPnlPct: -40.8,
      mfeCapturePct: null,
      closedReason: "stopped",
    }),
  );
  assert.ok(line);
  assert.doesNotMatch(line!, /-158\.9%|MFE capture \*\*-/i);
  assert.match(line!, /round-tripped past breakeven/i);
});

// ─── vectorPlayCoaching ─────────────────────────────────────────────────────

test("vectorPlayCoaching: null when Vector has no play headline or invalidation", () => {
  assert.equal(vectorPlayCoaching(null, play()), null);
  assert.equal(
    vectorPlayCoaching({ play: {} } as unknown as Parameters<typeof vectorPlayCoaching>[0], play()),
    null,
  );
});

test("vectorPlayCoaching: returned line has an EVEN count of ** bold markers (no unpaired marker corrupting markdown)", () => {
  const vec = {
    play: {
      headline: "Bull flag breakout",
      invalidation: "95.00",
      thesis: "long continuation",
      starred: ["102.50"],
    },
  } as unknown as Parameters<typeof vectorPlayCoaching>[0];
  const line = vectorPlayCoaching(vec, play({ direction: "LONG" }));
  assert.ok(line);
  const boldMarkerCount = (line!.match(/\*\*/g) ?? []).length;
  assert.equal(boldMarkerCount % 2, 0, `expected an even (paired) count of **, got ${boldMarkerCount} in: ${line}`);
  assert.match(line!, /\*\*Bull flag breakout\*\*/);
  assert.match(line!, /\*\*95\.00\*\*/);
  assert.doesNotMatch(line!, /^\*\*Vector desk: \*\*/);
});

test("vexCoaching: narrates vanna flip", () => {
  const line = vexCoaching(
    {
      vexFlip: 100,
      gammaFlip: 98,
      vexWalls: { callWalls: [{ strike: 105 }], putWalls: [] },
    } as import("@/lib/bie/vector-full-state").VectorFullState,
    101,
  );
  assert.match(line!, /VEX lens/i);
  assert.match(line!, /diverge/i);
});

test("execSlippageCoaching: flags wide mid vs fill gap", () => {
  const line = execSlippageCoaching(play({ pnlPct: 50, execPnlPct: 30 }));
  assert.match(line!, /slippage/i);
});

test("bookContextCoaching: concentration or conflict when themes overlap", () => {
  const line = bookContextCoaching(
    play({ ticker: "NVDA", direction: "LONG" }),
    [{ ticker: "AMD", direction: "LONG" }],
  );
  if (line) assert.match(line, /concentration|conflict/i);
});

