import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  bookContextSection,
  catalystsSection,
  chartTechnicalsSection,
  dataFreshnessSection,
  deskConsensusSection,
  flowIntelSection,
  holdPlanSection,
  lessonsSection,
  meridianCatalystSection,
  whyThisSetupSection,
} from "./play-brief-intel";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { PortfolioPosition } from "./portfolio";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { VectorFullState } from "@/lib/bie/vector-full-state";

function fixturePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "140C · 20DTE",
    score: 75,
    status: "WATCH",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "BUY",
    factors: [],
    gates: [],
    ...overrides,
  };
}

test("bookContextSection: null when openBook is undefined or empty", () => {
  assert.equal(bookContextSection(fixturePlay(), undefined), null);
  assert.equal(bookContextSection(fixturePlay(), []), null);
});

test("bookContextSection: null when the book has no theme overlap with the candidate", () => {
  const book: PortfolioPosition[] = [{ ticker: "KO", direction: "LONG" }];
  assert.equal(bookContextSection(fixturePlay(), book), null);
});

test("bookContextSection: flags CONCENTRATION when an existing same-theme same-direction position is held", () => {
  const book: PortfolioPosition[] = [
    { ticker: "AMD", direction: "LONG" },
    { ticker: "SMH", direction: "LONG" },
  ];
  const section = bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book);
  assert.ok(section);
  assert.equal(section?.title, "Book context");
  assert.match(section?.body ?? "", /Concentration/i);
  assert.match(section?.body ?? "", /AMD LONG/);
  assert.match(section?.body ?? "", /SMH LONG/);
});

test("bookContextSection: flags INTERNAL CONFLICT when an existing same-theme opposed-direction position is held", () => {
  const book: PortfolioPosition[] = [{ ticker: "AMD", direction: "SHORT" }];
  const section = bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book);
  assert.ok(section);
  assert.match(section?.body ?? "", /Internal conflict/i);
  assert.match(section?.body ?? "", /AMD SHORT/);
});

test("bookContextSection: a duplicate/rolled row on the SAME ticker+direction is not reported as overlap", () => {
  const book: PortfolioPosition[] = [{ ticker: "NVDA", direction: "LONG" }];
  assert.equal(bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book), null);
});

// SWING-SYSTEM-CTO-AUDIT-style finding (found live 2026-09-06 on NRG SWING_NRG_34): `recNote` is
// already rendered verbatim by managementSection (open bucket) or the Verdict section (watch
// bucket) — see play-brief.ts lines 64 and 292. whyThisSetupSection pushed the SAME string again
// for any non-CLOSED play, so every open/watch brief repeated one full sentence across two
// sections — a narrative-quality defect ("bullet dump", not one connected trade-manager voice),
// not just a cosmetic wart: it also crowds out the pillar/signal content this section exists for.
test("whyThisSetupSection: does not repeat recNote — that's already surfaced by Management/Verdict", () => {
  const play = fixturePlay({
    status: "OPEN",
    recNote: "live hold — swing thesis Thesis health 46% — Thesis fading — tighten risk or trim into strength.",
  });
  const section = whyThisSetupSection(play);
  assert.ok(!section.body.includes(play.recNote as string));
});

test("whyThisSetupSection: still reports pillar/signal content when present", () => {
  const play = fixturePlay({
    status: "OPEN",
    recNote: "some note",
    factors: [{ label: "Momentum", points: 5 }],
  });
  const section = whyThisSetupSection(play);
  assert.match(section.body, /Momentum/);
});

test("holdPlanSection: does not repeat recNote or Management-owned rails — unique time/theta coaching only", () => {
  const recNote = "live hold — thesis fading — tighten risk";
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      recNote,
      contract: "14DTE 110C",
      manageAction: "TRIM_PARTIAL",
      exitPolicy: {
        policy: "trim_scale",
        hard_stop_pct: -50,
        target_pct: 100,
        trim_levels: [{ trigger_pct: 50, fraction: 0.33, premium: 7, fired: false }],
        runner_fraction: 0.34,
        stop_premium: 2,
        target_premium: 10,
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
  const section = holdPlanSection(ctx);
  assert.ok(section);
  assert.ok(!section!.body.includes(recNote));
  assert.ok(!section!.body.includes("Desk stance"));
  assert.ok(!section!.body.includes("Trim ladder"));
  assert.ok(!section!.body.includes("Rails:"));
  assert.ok(!section!.body.includes("Manage engine"));
  assert.match(section!.body, /14 DTE/);
  assert.match(section!.body, /15:50/);
});

// #4261 fixed holdPlanSection's recNote/rails duplication but left a second, same-class duplicate:
// the thesis-health `advisory` sentence is the exact text tradeManagerNarrativeSection's
// pillar-fade narration already carries in "Trade manager read" (both sections render for any
// live play). Found during the 2026-09-06 Ask Largo deep-dive on live NRG SWING_NRG_34.
test("holdPlanSection: does not repeat the thesis-health advisory sentence — already narrated by Trade manager read", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      contract: "110C · 12DTE",
      thesisHealth: {
        health: 46,
        entryIndex: 60,
        currentIndex: 46,
        delta: -14,
        rung: "degraded",
        rungLabel: "Degraded",
        pillars: [],
        moves: [],
        committedAtEt: null,
        computedAtEt: "10:00 ET",
        advisory: "Thesis fading — tighten risk or trim into strength.",
        thesisBreakLevel: "warn",
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
  const section = holdPlanSection(ctx);
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Thesis fading — tighten risk or trim into strength\./);
  assert.match(section!.body, /Thesis health \*\*46%\*\* \(Degraded\)/);
});

test("holdPlanSection: null when no unique hold-plan content beyond Management", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      recNote: "only note",
      contract: "90C",
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
  assert.equal(holdPlanSection(ctx), null);
});

test("deskConsensusSection: null when only NH direction / 0DTE stance (covered by crossDeskCoaching)", () => {
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-09-05",
      direction: "long",
      conviction: "high",
      outcome: "",
    },
    zerodte_today: { direction: "long", score: 82 },
  };
  assert.equal(deskConsensusSection(eco, fixturePlay()), null);
});

test("deskConsensusSection: narrates NH outcome history when present", () => {
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-09-04",
      direction: "long",
      conviction: "medium",
      outcome: "WIN",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }));
  assert.ok(section);
  assert.equal(section?.title, "Desk context");
  assert.match(section?.body ?? "", /closed \*\*WIN\*\*/i);
  assert.match(section?.body ?? "", /weigh that track record/i);
});

test("deskConsensusSection: an unresolved last swing (outcome 'open') never reads as 'closed open' — a live contradiction", () => {
  // Reproduces a live production case: AAPL positionId 36's CLOSED brief cited Night Hawk's
  // last swing (2026-07-29) as "closed **open**" because outcome is "open" | "pending" |
  // "target" | "stop" | "ambiguous" | "unfilled" (play-outcomes.ts) and only "target"/"stop"
  // are actually terminal — "open" and "pending" mean the swing hasn't resolved yet.
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-07-29",
      direction: "long",
      conviction: "medium",
      outcome: "open",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }));
  assert.ok(section);
  assert.doesNotMatch(section?.body ?? "", /closed \*\*open\*\*/i);
  assert.match(section?.body ?? "", /still \*\*unresolved\*\*/i);
});

test("deskConsensusSection: outcome 'pending' also reads as unresolved, not closed", () => {
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-07-29",
      direction: "short",
      conviction: "medium",
      outcome: "pending",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "SHORT" }));
  assert.ok(section);
  assert.doesNotMatch(section?.body ?? "", /closed \*\*pending\*\*/i);
  assert.match(section?.body ?? "", /still \*\*unresolved\*\*/i);
});

test("deskConsensusSection: null when only flow anomaly (covered by flowNarrative + Flow & positioning)", () => {
  const eco: EcosystemContext = {
    recent_anomalies: [{ anomaly_type: "sweep_cluster", detail: "$4.2M call sweeps at 145" }],
  };
  assert.equal(deskConsensusSection(eco, fixturePlay()), null);
});

test("lessonsSection: a round-trip past breakeven never renders a nonsensical negative MFE capture", () => {
  // Reproduces a live production case: INTC:35 peak +25.7%, exited -40.8% used to render
  // "MFE capture: -158.9% of peak move" (exitPnlPct / peak * 100), a percentage with no honest reading.
  const section = lessonsSection(
    fixturePlay({
      status: "CLOSED",
      peak: 25.7,
      exitPnlPct: -40.8,
      mfeCapturePct: null,
      closedReason: "stopped",
    }),
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /-158\.9%|MFE capture: \*\*-/i);
  assert.match(section!.body, /round-tripped past breakeven/i);
});

function fixtureVec(overrides: Partial<VectorFullState> = {}): VectorFullState {
  return {
    spot: 100,
    technicals: null,
    regime: null,
    play: null,
    ...overrides,
  } as unknown as VectorFullState;
}

test("catalystsSection: short vol ratio renders as a sane percent from a 0–1 fraction (audit #12)", () => {
  const section = catalystsSection({
    ticker: "CRWD",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    recent_anomalies: [],
    flow_full_state: null,
    spx_play: null,
    spx_full_state: null,
    vector_full_state: null,
    gex_positioning: null,
    flow_feed_fresh: true,
    arsenal: {
      scope: "single_name",
      earnings: null,
      fundamentals: { days_to_cover: 3.4, short_volume_ratio: 0.6913, price_target: null, as_of: "2026-09-05" },
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.match(section!.body, /short vol ratio \*\*69%\*\*/);
  assert.doesNotMatch(section!.body, /6913%/);
});

test("chartTechnicalsSection: bias reads bearish from the technicals on a SHORT play whose tape is entirely bullish (FINDINGS 2026-09-06 #13, INTC shape)", () => {
  // Reproduces the live INTC envelope: SHORT position, but EMA-up/above-VWAP/RSI-bull/CHOCH-up —
  // an entirely bullish technical picture. The badge must say bullish (the tape), not bearish
  // (the position direction it used to echo).
  const vec = fixtureVec({
    spot: 95,
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  });
  const section = chartTechnicalsSection(vec);
  assert.equal(section?.bias, "bullish");
});

test("chartTechnicalsSection: bias reads bearish from the technicals on a LONG play whose tape is entirely bearish (FINDINGS 2026-09-06 #13, NN shape)", () => {
  const vec = fixtureVec({
    spot: 15,
    technicals: {
      vwap: 15.29,
      emaStack: "down",
      rsi: 40,
      macd: "bear",
      goldenPocket: null,
      structure: { type: "BOS", direction: "down", level: 15.5 },
    },
  });
  const section = chartTechnicalsSection(vec);
  assert.equal(section?.bias, "bearish");
});

test("chartTechnicalsSection: bias is neutral on a genuine split vote (2-2), never fabricated", () => {
  const vec = fixtureVec({
    spot: 105, // above vwap -> bull
    technicals: {
      vwap: 100,
      emaStack: "down", // bear
      rsi: 50,
      macd: "bull", // bull
      goldenPocket: null,
      structure: { type: "BOS", direction: "down", level: 90 }, // bear
    },
  });
  const section = chartTechnicalsSection(vec);
  assert.equal(section?.bias, "neutral");
});

test("dataFreshnessSection: option mark timestamp renders as a Largo C1 ET stamp, never a raw UTC instant (FINDINGS 2026-09-06 #21)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ markAsOf: "2026-09-04T21:45:18.663Z" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /2026-09-04 17:45 ET/);
  assert.doesNotMatch(section!.body, /\.663Z/, "must not print a raw ISO mark timestamp");
});

test("dataFreshnessSection: stale ecosystem.vector_full_state warns when ctx.vector is null", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      vector_full_state: fixtureVec({ dataAgeMs: 180_000 }),
    } as EcosystemContext,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /Vector data \*\*180s\*\* old/);
});

test("dataFreshnessSection: prior-session scan warns when scanSessionDay lags sessionDate", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: "2026-09-05T20:00:00.000Z",
    scanSessionDay: "2026-09-05",
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /prior session 2026-09-05/);
  assert.match(section!.body, /today's discovery not yet run/);
});

test("dataFreshnessSection: closed play with markIsSync does not warn mark age unknown", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "CLOSED", markIsSync: true, markAsOf: null }),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.equal(section, null, "closed play with no live mark should not emit a freshness section");
});

test("dataFreshnessSection: stale HELIX pipeline warns when flow_feed_fresh is false", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: "2026-09-06T14:30:00.000Z",
    scanSessionDay: "2026-09-06",
    laneRows: [],
    meridian: null,
    ecosystem: { flow_feed_fresh: false } as EcosystemContext,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /HELIX flow: \*\*pipeline stale\*\*/);
  assert.match(section!.body, /tape read may lag/);
});

test("meridianCatalystSection: empty successful read states quiet calendar, not silence", () => {
  const section = meridianCatalystSection({
    play: fixturePlay(),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: { as_of: "2026-09-06 09:00 ET", items: [], total_matched: 0 },
    ecosystem: null,
    vector: null,
  });
  assert.ok(section);
  assert.match(section!.body, /No catalysts in the \*\*14-day\*\* Meridian window/);
  assert.match(section!.body, /quiet, not missing/);
});

test("whyThisSetupSection: surfaces subLane alongside archetype", () => {
  const section = whyThisSetupSection(
    fixturePlay({ archetype: "momentum_breakout", subLane: "earnings_lead" }),
  );
  assert.match(section.body, /\*\*Archetype:\*\* momentum breakout/);
  assert.match(section.body, /\*\*Sub-lane:\*\* earnings lead/);
});

test("flowIntelSection: stale HELIX feed must not render recent prints or anomalies", () => {
  const eco = {
    ticker: "INTC",
    flow_feed_fresh: false,
    recent_flow: null,
    recent_anomalies: [{ anomaly_type: "sweep", detail: "big call sweep", direction: "bullish" }],
    flow_full_state: {
      recent: [{ option_type: "call", strike: 50, premium: 1_000_000 }],
    },
    zerodte_today: null,
    gex_positioning: null,
    arsenal: null,
    vector_full_state: null,
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay());
  assert.equal(section, null, "stale feed with only cached prints/anomalies must not invent flow intel");
});
