import assert from "node:assert/strict";
import test from "node:test";
import type { TerminalPlay } from "./types";
import {
  expectedMovePct,
  marketContextItems,
  tradeSummaryDisplay,
  confluenceChecklist,
  convictionDisplay,
  decisionWindowLabel,
  engineChecklist,
  managementActionDisplay,
  strengthBarBlocks,
  strengthBarSegmentFills,
  thesisStrengthPct,
  tradeOutcomeDisplay,
  trimLadderVisual,
} from "./terminal-display";

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "182C · 0DTE",
    occ: "NVDA260725C00182000",
    score: 82,
    status: "OPEN",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [],
    gates: [{ label: "Hard gate", ok: true }, { label: "Tape align", ok: true }],
    recommendation: "HOLD",
    entry: 2,
    mark: 2.6,
    pnlPct: 30,
    peak: 87,
    trough: -50,
    tierLabel: "A",
    thesisHealth: {
      health: 82,
      currentIndex: 92,
      advisory: "Thesis intact",
      pillars: [
        { id: "flow", label: "Flow", status: "intact" },
        { id: "dealer", label: "Dealer", status: "intact" },
        { id: "vwap", label: "VWAP", status: "intact" },
        { id: "market", label: "Breadth", status: "intact" },
        { id: "structure", label: "Gamma", status: "faded" },
        { id: "volatility", label: "Vol", status: "lost" },
      ],
      committedAtEt: "10:15",
    },
    ...overrides,
  };
}

test("thesisStrengthPct: uses thesis health when wired", () => {
  assert.equal(thesisStrengthPct(play()), 82);
});

test("thesisStrengthPct: null when no health signal", () => {
  assert.equal(thesisStrengthPct(play({ thesisHealth: null })), null);
});

test("convictionDisplay: grade + score from tier and quality", () => {
  const c = convictionDisplay(play());
  assert.equal(c.grade, "A");
  assert.ok(c.score != null && c.score > 0);
});

test("confluenceChecklist: six lenses from pillars", () => {
  const items = confluenceChecklist(play());
  assert.equal(items.length, 6);
  assert.equal(items.find((i) => i.label === "Vol")?.ok, false);
  assert.equal(items.find((i) => i.label === "Flow")?.ok, true);
});

test("engineChecklist: gates fallback when no thesis health", () => {
  const items = engineChecklist(play({ thesisHealth: null }));
  assert.equal(items.length, 5);
  assert.equal(items.find((i) => i.label === "Breadth")?.ok, true);
});

test("marketContextItems: gamma trend dealer from pillars", () => {
  const items = marketContextItems(play());
  assert.ok(items.length >= 2);
  assert.equal(items.find((i) => i.label === "Gamma")?.value, "Positive");
});

test("expectedMovePct: from target premium vs entry", () => {
  const pct = expectedMovePct(play({
    entry: 2,
    exitPolicy: {
      policy: "trim_scale",
      trim_levels: [],
      runner_fraction: 1,
      stop_premium: 1,
      target_premium: 2.86,
      time_stop_et: "15:30",
    },
  }));
  assert.equal(pct, 43);
});

test("tradeSummaryDisplay: persistent hero fields", () => {
  const s = tradeSummaryDisplay(play({ status: "CLOSED", pnlPct: -50, peak: 87 }));
  assert.equal(s.ticker, "NVDA");
  assert.equal(s.grade, "A");
  assert.equal(s.peakPct, 87);
  assert.equal(s.currentPct, -50);
});

test("managementActionDisplay: WATCH candidates never fabricate probability", () => {
  const action = managementActionDisplay(play({ status: "WATCH", pnlPct: null }), "HOLD", null);
  assert.equal(action.probabilityPct, null);
});

test("managementActionDisplay: SELL sizing and probability", () => {
  const action = managementActionDisplay(play(), "SELL", 0.9);
  assert.equal(action.verb, "SELL");
  assert.equal(action.sizePct, 100);
  assert.equal(action.urgency, "NOW");
  assert.ok(action.probabilityPct != null);
});

// Regression for finding #19 (docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md): SWING's exit
// policy (SWING_SCALE_OUT_POLICY, src/lib/swing/exit-policy.ts) is a SINGLE-tranche ladder — one
// level banking 50% at 2x, then a runner. Once that one level fires (true for essentially every
// SWING play whose recommendation reaches TRIM), `trim_levels.find(t => !t.fired)` returns
// undefined. The old code then fell back to a hardcoded `33` — a magic constant copied from
// 0DTE's UNRELATED 3-tranche (1/3 each) trim_scale ladder — fabricating a "TRIM 33%" size that
// exists nowhere in SWING's actual policy. Matches the honest fallback the sibling function
// (play-card-lifecycle.ts's swingActionDisplay) already uses for this exact case: a bare "TRIM"
// verb with no fabricated percentage (sizePct null), which both render call sites
// (TerminalPremiumPanels.tsx's ManagementActionCard, SwingLargoInsightsPanel.tsx's
// SwingBriefActionStrip) already render null-safely (`action.sizePct != null ? ...% : null`).
test("managementActionDisplay: SWING all-trims-fired never fabricates the 0DTE 33% fallback", () => {
  const action = managementActionDisplay(
    play({
      horizon: "SWING",
      status: "TRIM",
      entry: 16.65,
      mark: 38.25,
      exitPolicy: {
        policy: "trim_scale",
        trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 33.3, fired: true }],
        runner_fraction: 0.5,
        stop_premium: 6.66,
        target_premium: 33.3,
        time_stop_et: "16:00",
      },
    }),
    "TRIM",
    null
  );
  assert.equal(action.verb, "TRIM");
  assert.notEqual(action.sizePct, 33);
  assert.equal(action.sizePct, null);
});

test("managementActionDisplay: SWING with a genuine pending trim level still sizes it honestly", () => {
  const action = managementActionDisplay(
    play({
      horizon: "SWING",
      status: "TRIM",
      entry: 16.65,
      mark: 20,
      exitPolicy: {
        policy: "trim_scale",
        trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 33.3, fired: false }],
        runner_fraction: 0.5,
        stop_premium: 6.66,
        target_premium: 33.3,
        time_stop_et: "16:00",
      },
    }),
    "TRIM",
    null
  );
  assert.equal(action.sizePct, 50);
});

test("trimLadderVisual: banked + runner states", () => {
  const rows = trimLadderVisual({
    policy: "trim_scale",
    trim_levels: [
      { fraction: 0.33, trigger_pct: 50, premium: 3, fired: true },
      { fraction: 0.33, trigger_pct: 100, premium: 4, fired: false },
    ],
    runner_fraction: 0.34,
    stop_premium: 1,
    target_premium: 5,
    time_stop_et: "15:30",
  });
  assert.equal(rows[0]?.state, "banked");
  assert.equal(rows[rows.length - 1]?.state, "live");
});

test("trimLadderVisual: runner row shows frozen 300% target", () => {
  const rows = trimLadderVisual(
    {
      policy: "trim_scale",
      trim_levels: [{ fraction: 0.4, trigger_pct: 40, premium: 2, fired: false }],
      runner_fraction: 0.6,
      stop_premium: 1,
      target_premium: 4,
      time_stop_et: "15:30",
    },
    300
  );
  assert.match(rows[rows.length - 1]!.label, /300%/);
  assert.equal(rows[rows.length - 1]!.triggerPct, 300);
});

test("tradeOutcomeDisplay: closed loss verdict", () => {
  const o = tradeOutcomeDisplay(play({ status: "CLOSED", pnlPct: -50 }));
  assert.equal(o.verdict, "LOSS");
  assert.equal(o.closePct, -50);
  assert.equal(o.bestPct, 87);
  assert.equal(o.worstPct, -50);
});

test("strengthBarBlocks: 10-block meter", () => {
  assert.equal(strengthBarBlocks(82).length, 10);
  assert.match(strengthBarBlocks(82), /^█+/);
});

test("strengthBarSegmentFills: boolean segments", () => {
  const fills = strengthBarSegmentFills(50, 10);
  assert.equal(fills.filter(Boolean).length, 5);
});

test("decisionWindowLabel: mm:ss parts", () => {
  assert.deepEqual(decisionWindowLabel(2.3), { mins: "2", secs: "18" });
});
