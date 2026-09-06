import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import {
  catalystCoaching,
  closedCoaching,
  crossDeskCoaching,
  dataHonestyCoaching,
  execSlippageCoaching,
  ivRankCoaching,
  manageLifecycleCoaching,
  thesisBreakCoaching,
  thesisPillarCoaching,
  vectorPlayCoaching,
  vexCoaching,
  watchGateCoaching,
  technicalsCoaching,
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

function uncalibratedThesisHealth() {
  return {
    health: 46,
    entryIndex: 60,
    currentIndex: 46,
    delta: -14,
    rung: "DEGRADED",
    rungLabel: "Degraded",
    pillars: [
      {
        id: "structure",
        label: "Persistence",
        weight: 0.28,
        commitScore: 0.4,
        currentScore: 0.35,
        commitLabel: "unknown",
        currentLabel: "unknown",
        status: "intact",
        contributionPts: 10,
        deltaPts: -1,
      },
      {
        id: "momentum",
        label: "Entry geometry",
        weight: 0.22,
        commitScore: 0.5,
        currentScore: 0.45,
        commitLabel: "n/a",
        currentLabel: "n/a",
        status: "intact",
        contributionPts: 10,
        deltaPts: -1,
      },
      {
        id: "flow",
        label: "Signal stack",
        weight: 0.2,
        commitScore: 0.35,
        currentScore: 0.35,
        commitLabel: "no signals",
        currentLabel: "no signals",
        status: "intact",
        contributionPts: 7,
        deltaPts: 0,
      },
    ],
    moves: ["Persistence: unknown → unknown"],
    committedAtEt: null,
    computedAtEt: "10:00 ET",
    advisory: "Thesis fading — tighten risk or trim into strength.",
    thesisBreakLevel: "warn",
    thesisBreakNote: "pillars fading",
  };
}

test("thesisBreakCoaching: silent when thesis health is uncalibrated (extends #4318)", () => {
  assert.equal(thesisBreakCoaching(play({ thesisHealth: uncalibratedThesisHealth() })), null);
});

test("thesisPillarCoaching: silent when thesis health is uncalibrated (extends #4318)", () => {
  assert.equal(thesisPillarCoaching(play({ thesisHealth: uncalibratedThesisHealth() })), null);
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

test("crossDeskCoaching: Vector bearish bias conflicts with LONG swing", () => {
  const line = crossDeskCoaching(
    ctx({
      vector: {
        play: {
          bias: "short",
          headline: "Fade the rip",
          grade: "B",
        },
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
  );
  assert.match(line!, /Cross-desk friction/i);
  assert.match(line!, /Vector bearish/i);
  assert.match(line!, /Fade the rip/i);
});

test("crossDeskCoaching: stale HELIX flow must not invent call-led / put-led friction", () => {
  const line = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "INTC",
        flow_feed_fresh: false,
        recent_flow: {
          window_hours: 24,
          print_count: 12,
          call_premium: 1_200_000,
          put_premium: 400_000,
          unknown_premium: 0,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "SHORT" }),
  );
  assert.equal(line, null, "stale HELIX must not coach cross-desk flow friction");
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

test("vectorPlayCoaching: uses play.bias not thesis substring (long-gamma thesis vs short bias)", () => {
  const vec = {
    play: {
      bias: "short",
      headline: "Fade into wall",
      thesis: "Long gamma (spot pinned)",
      invalidation: "102.00",
    },
  } as unknown as Parameters<typeof vectorPlayCoaching>[0];
  const line = vectorPlayCoaching(vec, play({ direction: "LONG" }));
  assert.ok(line);
  assert.match(line!, /cross-check/i);
  assert.doesNotMatch(line!, /aligned with swing lane/i);
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

test("dataHonestyCoaching: markIsSync true (no timestamp) warns; fresh markAsOf does not", () => {
  const stale = dataHonestyCoaching(ctx(), play({ markIsSync: true, status: "OPEN" }));
  assert.match(stale!, /mark not synced to live tape/i);

  const fresh = dataHonestyCoaching(ctx(), play({ markIsSync: false, markAsOf: "2026-09-04T21:45:18.731Z" }));
  assert.equal(fresh, null);
});

test("dataHonestyCoaching: closed play with markIsSync does not warn mark staleness", () => {
  const line = dataHonestyCoaching(ctx(), play({ markIsSync: true, status: "CLOSED" }));
  assert.equal(line, null);
});

test("dataHonestyCoaching: WATCH play with markIsSync does not warn mark staleness", () => {
  const line = dataHonestyCoaching(ctx(), play({ markIsSync: true, status: "WATCH" }));
  assert.equal(line, null);
});

test("dataHonestyCoaching: prior-session discovery scan warns", () => {
  const line = dataHonestyCoaching(
    ctx({ sessionDate: "2026-09-06", scanSessionDay: "2026-09-05" }),
    play(),
  );
  assert.match(line!, /swing discovery from \*\*2026-09-05\*\*/);
  assert.match(line!, /today's scan not yet run/);
});

test("dataHonestyCoaching: stale HELIX pipeline warns stale, not quiet", () => {
  const line = dataHonestyCoaching(
    ctx({ ecosystem: { flow_feed_fresh: false } as SwingPlayBriefContext["ecosystem"] }),
    play(),
  );
  assert.match(line!, /HELIX pipeline stale/);
  assert.match(line!, /not evidence of quiet tape/);
  assert.doesNotMatch(line!, /feed quiet/i);
});

test("execSlippageCoaching: flags wide mid vs fill gap", () => {
  const line = execSlippageCoaching(play({ pnlPct: 50, execPnlPct: 30 }));
  assert.match(line!, /slippage/i);
});

test("ivRankCoaching: fires when play carries ivRank", () => {
  const elevated = ivRankCoaching(play({ ivRank: 75 }));
  assert.match(elevated!, /IV rank 75/i);
  assert.match(elevated!, /vol elevated/i);

  const cheap = ivRankCoaching(play({ ivRank: 20 }));
  assert.match(cheap!, /IV rank 20/i);
  assert.match(cheap!, /vol cheap/i);

  assert.equal(ivRankCoaching(play({ ivRank: null })), null);
});

test("technicalsCoaching: bias reads bullish from tape on SHORT play (Largo C5 — chart evidence, not position direction)", () => {
  const vec = {
    spot: 95,
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  const line = technicalsCoaching(vec, play({ direction: "SHORT", ticker: "INTC" }));
  assert.match(line!, /chart reads bullish/i);
  assert.match(line!, /conflicts with swing direction/i);
  assert.doesNotMatch(line!, /supports short swing/i);
});

test("technicalsCoaching: bias reads bearish from tape on LONG play (Largo C5)", () => {
  const vec = {
    spot: 15,
    technicals: {
      vwap: 15.29,
      emaStack: "down",
      rsi: 40,
      macd: "bear",
      goldenPocket: null,
      structure: { type: "BOS", direction: "down", level: 15.5 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  const line = technicalsCoaching(vec, play({ direction: "LONG", ticker: "NN" }));
  assert.match(line!, /chart reads bearish/i);
  assert.match(line!, /conflicts with swing direction/i);
  assert.doesNotMatch(line!, /supports long swing/i);
});

test("technicalsCoaching: aligned LONG + bullish tape notes alignment without echoing direction as bias", () => {
  const vec = {
    spot: 100,
    technicals: {
      vwap: 98,
      emaStack: "up",
      rsi: 55,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "BOS", direction: "up", level: 99 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  const line = technicalsCoaching(vec, play({ direction: "LONG" }));
  assert.match(line!, /chart reads bullish/i);
  assert.match(line!, /aligns with swing direction/i);
});