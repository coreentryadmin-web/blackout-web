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

test("composeSwingPlayBrief: WATCH play emits entry + pillars sections", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: "2026-09-05T19:30:00.000Z",
    scanSessionDay: "2026-09-05",
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.engine, "swing_play_intelligence");
  assert.equal(brief.ticker, "INTC");
  assert.ok(brief.envelope.headline.includes("INTC"));
  const titles = brief.envelope.sections.map((s) => s.title);
  assert.ok(titles.includes("Verdict"));
  assert.ok(titles.includes("Entry"));
  assert.ok(titles.includes("Score pillars"));
  assert.ok(brief.envelope.sections.some((s) => s.body.includes("G-S6")));
  assert.equal(brief.envelope.intent, "swing_play_brief");
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
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const titles = brief.envelope.sections.map((s) => s.title);
  assert.ok(titles.includes("Management"));
  assert.ok(titles.includes("Thesis health"));
  assert.ok(titles.includes("Position"));
  assert.ok(brief.envelope.sections.some((s) => s.body.includes("54%")));
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
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.ok(brief.envelope.sections.some((s) => s.title === "Outcome" && s.body.includes("42")));
});
