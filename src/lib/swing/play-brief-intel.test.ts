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
  lessonsSection,
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
