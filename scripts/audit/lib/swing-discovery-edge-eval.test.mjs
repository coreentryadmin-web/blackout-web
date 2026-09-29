import { test } from "node:test";
import assert from "node:assert/strict";
import {
  derivePreEntryMetrics,
  deriveOutcomeMetrics,
  deriveRowMetrics,
  groupByCategory,
} from "./swing-discovery-edge-eval.mjs";

function baseRow(overrides = {}) {
  return {
    positionId: 41,
    ticker: "HUT",
    direction: "long",
    score: 78.2,
    contract: { strike: 106, right: "C", expiry: "2026-10-02", dte: 8, delta: 0.57 },
    archetype: "SECTOR_ROTATION",
    subLane: "STANDARD",
    entryPresentPillars: null,
    topFlowProvenance: { topFlowStrike: 105, matchedPick: false },
    firstSeenAt: "2026-09-22T16:04:59.000Z",
    committedAt: "2026-09-22T16:04:59.000Z",
    entryPremium: 7.9,
    peakPremium: 7.9,
    troughPremium: 3.55,
    exitAt: "2026-09-24T13:30:40.000Z",
    exitPnlPct: -55.06,
    closedReason: "stopped",
    cortex: {
      score: 0.4,
      decision: "PASS",
      conviction: "C",
      abstained: false,
      supports: [{ source: "flow-quality" }, { source: "vex-charm" }],
      opposes: [],
      vetoes: [],
      absent: ["gex-walls", "wall-trend", "sector-heat", "catalyst-news", "darkpool-confluence", "opening-harvest"],
    },
    ...overrides,
  };
}

test("derivePreEntryMetrics: reads only commit-time fields, never outcome fields", () => {
  const row = baseRow();
  const m = derivePreEntryMetrics(row);
  assert.equal(m.score, 78.2);
  assert.equal(m.cortexScore, 0.4);
  assert.equal(m.cortexConviction, "C");
  assert.equal(m.cortexDecision, "PASS");
  assert.equal(m.cortexAbstained, false);
  assert.equal(m.cortexSupportCount, 2);
  assert.equal(m.cortexOpposeCount, 0);
  assert.equal(m.cortexVetoCount, 0);
  assert.equal(m.cortexAbsentCount, 6);
  assert.equal(m.direction, "LONG");
  assert.equal(m.archetype, "SECTOR_ROTATION");
  assert.equal(m.subLane, "STANDARD");
  assert.equal(m.dte, 8);
  assert.equal(m.deltaAbs, 0.57);
  assert.equal(m.strike, 106);
  assert.equal(m.entryPremium, 7.9);
  assert.equal(m.topFlowMatchedPick, false);
  assert.equal(m.watchToCommitDays, 0); // firstSeenAt === committedAt here
  assert.equal(m.dayOfWeek, 2); // 2026-09-22 is a Tuesday
  assert.equal(Object.keys(m).includes("peakPremium"), false);
  assert.equal(Object.keys(m).includes("exitPnlPct"), false);
});

test("derivePreEntryMetrics: |delta| takes magnitude for a SHORT/put position, direction carried separately", () => {
  const row = baseRow({ direction: "short", contract: { strike: 20, right: "P", expiry: "2026-10-02", dte: 5, delta: -0.62 } });
  const m = derivePreEntryMetrics(row);
  assert.equal(m.direction, "SHORT");
  assert.equal(m.deltaAbs, 0.62);
});

test("derivePreEntryMetrics: watchToCommitDays reflects a real WATCH-to-commit lag, never negative-looking on same-day", () => {
  const row = baseRow({ firstSeenAt: "2026-09-18T14:00:00.000Z", committedAt: "2026-09-22T16:04:59.000Z" });
  const m = derivePreEntryMetrics(row);
  assert.ok(m.watchToCommitDays > 4 && m.watchToCommitDays < 5);
});

test("derivePreEntryMetrics: missing cortex/contract degrades to null, never fabricates a value", () => {
  const m = derivePreEntryMetrics({ ticker: "X", committedAt: "2026-09-22T16:04:59.000Z" });
  assert.equal(m.score, null);
  assert.equal(m.cortexScore, null);
  assert.equal(m.cortexDecision, null);
  assert.equal(m.dte, null);
  assert.equal(m.deltaAbs, null);
  assert.equal(m.watchToCommitDays, null); // firstSeenAt missing
});

test("deriveOutcomeMetrics: MFE/MAE are relative retracement from entry premium, matching banger's convention", () => {
  const row = baseRow({ entryPremium: 2, peakPremium: 6, troughPremium: 1, exitPnlPct: 150 });
  const m = deriveOutcomeMetrics(row);
  assert.equal(m.mfePct, 200); // (6/2 - 1) * 100
  assert.equal(m.maePct, -50); // (1/2 - 1) * 100
  assert.equal(m.realizedPnlPct, 150);
  assert.equal(m.is100PlusMfe, true);
  assert.equal(m.is100PlusRealized, true);
  assert.equal(m.isLoss, false);
  assert.equal(m.closedReason, "stopped");
});

test("deriveOutcomeMetrics: holdDays is commit-to-exit duration, an honest proxy, not true time-to-MFE", () => {
  const row = baseRow({ committedAt: "2026-09-22T16:04:59.000Z", exitAt: "2026-09-24T13:30:40.000Z" });
  const m = deriveOutcomeMetrics(row);
  assert.ok(m.holdDays > 1.8 && m.holdDays < 2);
});

test("deriveOutcomeMetrics: a real loser whose peak equals entry (never traded green) — mfePct is exactly 0, not fabricated", () => {
  const row = baseRow({ entryPremium: 7.9, peakPremium: 7.9, troughPremium: 3.55, exitPnlPct: -55.06 });
  const m = deriveOutcomeMetrics(row);
  assert.equal(m.mfePct, 0);
  assert.ok(m.maePct < -50);
  assert.equal(m.isLoss, true);
});

test("deriveRowMetrics joins pre-entry and outcome without collision, carries positionId/ticker", () => {
  const m = deriveRowMetrics(baseRow());
  assert.equal(m.positionId, 41);
  assert.equal(m.ticker, "HUT");
  assert.equal(m.score, 78.2);
  assert.equal(m.realizedPnlPct, -55.06);
});

test("groupByCategory: groups by exact categorical value, computes per-group outcome stats", () => {
  const rows = [
    deriveRowMetrics(baseRow({ archetype: "SECTOR_ROTATION", exitPnlPct: -50 })),
    deriveRowMetrics(baseRow({ archetype: "SECTOR_ROTATION", exitPnlPct: 50, peakPremium: 20 })),
    deriveRowMetrics(baseRow({ archetype: "EVENT_DRIVEN", exitPnlPct: 10, peakPremium: 15 })),
  ];
  const groups = groupByCategory(rows, "archetype");
  const sector = groups.find((g) => g.label === "SECTOR_ROTATION");
  const event = groups.find((g) => g.label === "EVENT_DRIVEN");
  assert.equal(sector.n, 2);
  assert.equal(sector.winRate, 50); // 1 win of 2
  assert.equal(event.n, 1);
  assert.equal(event.winRate, 100);
  // Sorted by n descending.
  assert.equal(groups[0].label, "SECTOR_ROTATION");
});

test("groupByCategory: a row missing the category key is excluded from every group, never bucketed as 'null'", () => {
  const rows = [
    deriveRowMetrics(baseRow({ archetype: null })),
    deriveRowMetrics(baseRow({ archetype: "SECTOR_ROTATION" })),
  ];
  const groups = groupByCategory(rows, "archetype");
  const totalN = groups.reduce((a, g) => a + g.n, 0);
  assert.equal(totalN, 1);
});
