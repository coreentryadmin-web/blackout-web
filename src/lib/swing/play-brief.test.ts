import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { composeSwingPlayBrief } from "./play-brief";
import type { SwingPlayBriefContext } from "./play-brief-types";

function fixturePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:INTC",
    ticker: "INTC",
    direction: "LONG",
    contract: "90C · 13DTE",
    score: 72,
    tierLabel: "B",
    status: "WATCH",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "BUY",
    recNote: "Pullback to entry zone — persistence confirmed.",
    factors: [
      { label: "Rel. strength", points: 18 },
      { label: "Regime", points: 12 },
    ],
    regime: "Sector rotation · regime 0.82",
    archetype: "BREAKOUT",
    servingSection: "WAITING_FOR_ENTRY",
    setupState: "FORMING",
    entryStatus: "PRE_TRIGGER",
    swingEntryAction: "buy",
    gateBlocks: [{ code: "G-S6", reason: "Bucket not graduated" }],
    thesisBreak: { level: "intact", note: "Structure holding" },
    ...overrides,
  };
}

test("composeSwingPlayBrief: WATCH play emits entry + intel sections", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ discoveryOrigin: ["FLOW", "BREAKOUT"] }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: "2026-09-05T19:30:00.000Z",
    scanSessionDay: "2026-09-05",
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      zerodte_today: null,
      nighthawk_recent: null,
      recent_audit_entries: [],
      recent_flow: {
        window_hours: 24,
        print_count: 12,
        call_premium: 1_200_000,
        put_premium: 400_000,
        unknown_premium: 0,
      },
      recent_anomalies: [],
      flow_full_state: null,
      spx_play: null,
      spx_full_state: null,
      spx_desk_convergence: null,
      flow_feed_fresh: true,
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        change_pct: 1.2,
        asof: "2026-09-05T20:00:00Z",
        as_of_et: "2026-09-05 16:00 ET",
        session_date_et: "2026-09-05",
        market_phase: "closed",
        call_wall: 26,
        put_wall: 22,
        flip: 24,
        gex_king_strike: 25,
        net_gex: null,
        nearest_wall: { strike: 26, kind: "resistance", distance_pts: 1.5 },
        gamma_posture: "long",
        vanna_posture: null,
        delta_posture: null,
        charm_posture: null,
      },
      vector_full_state: null,
      arsenal: {
        scope: "single_name",
        earnings: { earnings_date: "2026-09-12", days_until: 7, report_time: "AMC", is_confirmed: true },
        fundamentals: { days_to_cover: 2.1, short_volume_ratio: 0.35, price_target: null, as_of: "2026-09-05" },
        related: ["AMD", "NVDA"],
        news: { count: 2, newest: "2026-09-05", headlines: ["INTC restructures fab unit"] },
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    },
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.engine, "swing_play_intelligence");
  assert.equal(brief.ticker, "INTC");
  assert.ok(brief.envelope.headline.includes("INTC"));
  const titles = brief.envelope.sections.map((s) => s.title);
  assert.ok(titles.includes("Verdict"));
  assert.ok(titles.includes("Entry"));
  assert.ok(titles.includes("Why this setup"));
  assert.ok(titles.includes("Flow & positioning"));
  assert.ok(titles.includes("Catalysts & news"));
  assert.ok(titles.includes("Watch levels"));
  assert.ok(brief.envelope.sections.some((s) => s.body.includes("FLOW")));
  assert.ok(brief.envelope.sections.some((s) => s.body.includes("Earnings")));
  assert.equal(brief.envelope.intent, "swing_play_brief");
  assert.deepEqual(brief.flowSnapshot, { callPremium: 1_200_000, putPremium: 400_000 });
});

test("composeSwingPlayBrief: flowSnapshot is null when HELIX has no recent-flow read", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.flowSnapshot, null);
});

test("composeSwingPlayBrief: OPEN play emits management + thesis health", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      entry: 4.9,
      mark: 9.7,
      pnlPct: 98,
      peak: 98,
      manageAction: "HOLD",
      thesisHealth: {
        health: 54,
        entryIndex: 60,
        currentIndex: 54,
        delta: -6,
        rung: "DEGRADED",
        rungLabel: "Thesis fading",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.28,
            commitScore: 0.9,
            currentScore: 0.4,
            commitLabel: "triggered",
            currentLabel: "unknown",
            status: "faded",
            contributionPts: 11,
            deltaPts: -8,
          },
        ],
        moves: ["Persistence weakened"],
        committedAtEt: "Sep 3, 10:00 AM",
        computedAtEt: "Sep 5, 4:00 PM",
        advisory: "Tighten risk",
        thesisBreakLevel: "warn",
        thesisBreakNote: "Thesis fading",
      },
      exitPolicy: {
        policy: "trim_scale",
        hard_stop_pct: -60,
        target_pct: 100,
        trim_levels: [{ trigger_pct: 50, fraction: 0.33, premium: 7.35, fired: true }],
        runner_fraction: 0.34,
        stop_premium: 1.96,
        target_premium: 9.8,
        time_stop_et: "15:50",
      },
    }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const titles = brief.envelope.sections.map((s) => s.title);
  assert.ok(titles.includes("Management"));
  assert.ok(titles.includes("Thesis health"));
  assert.ok(titles.includes("Position"));
  assert.ok(titles.includes("Hold plan"));
  assert.ok(titles.includes("Why this setup"));
  assert.ok(brief.envelope.sections.some((s) => s.body.includes("54%")));
});

test("composeSwingPlayBrief: OPEN with vector emits trade manager narrative", () => {
  const brief = composeSwingPlayBrief({
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD", direction: "LONG" }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: { window_hours: 24, print_count: 5, call_premium: 500_000, put_premium: 200_000, unknown_premium: 0 },
      gex_positioning: { spot: 100, flip: 98, gamma_posture: "long", gex_king_strike: 100 },
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      spot: 100,
      gammaFlip: 98,
      darkPoolLevels: [{ strike: 99, premium: 5_000_000, pct: 35 }],
      regime: { posture: "long", label: "LONG" },
      gexWalls: { callWalls: [{ strike: 105, pct: 8 }], putWalls: [{ strike: 97, pct: 7 }] },
      wallEvents: [{ kind: "call_wall_build", strike: 105, message: "Call wall building" }],
    } as SwingPlayBriefContext["vector"],
  });
  assert.ok(brief.envelope.sections.some((s) => s.title === "Trade manager read"));
  assert.ok(brief.envelope.sections.some((s) => s.title === "Trade manager read" && /dark pool|long gamma/i.test(s.body)));
  const titles = brief.envelope.sections.map((s) => s.title);
  assert.ok(!titles.includes("GEX posture"), "gamma posture should not duplicate trade manager read");
  assert.ok(!titles.includes("Wall dynamics"), "wall bead list should not duplicate trade manager read");
});

test("composeSwingPlayBrief: GEX posture supplements degraded trade manager read when spot missing", () => {
  const brief = composeSwingPlayBrief({
    play: fixturePlay({ status: "WATCH" }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        gamma_posture: "short",
        net_gex: -2_500_000,
        nearest_wall: { strike: 26, kind: "resistance", distance_pts: 1.5 },
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  });
  const titles = brief.envelope.sections.map((s) => s.title);
  assert.ok(titles.includes("Trade manager read"));
  assert.ok(titles.includes("GEX posture"));
});

test("composeSwingPlayBrief: CLOSED play emits outcome section", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "CLOSED",
      exitPnlPct: 42,
      closedReason: "scale_out_complete",
      mfeCapturePct: 68,
    }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.ok(brief.envelope.sections.some((s) => s.title === "Outcome" && s.body.includes("42")));
});
