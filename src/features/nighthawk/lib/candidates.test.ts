import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConfluenceGate,
  CONFLUENCE_MIN_SOURCES,
  CONFLUENCE_PROTECTED_TOP,
  formatLaneComposition,
  laneComposition,
  type MultiSourceCandidateRow,
} from "./candidates";

const row = (
  ticker: string,
  composite_score: number,
  sources: string[],
  laneScores?: Record<string, number>
): MultiSourceCandidateRow => ({
  ticker,
  composite_score,
  source_count: sources.length,
  sources,
  lane_scores: laneScores ?? Object.fromEntries(sources.map((s) => [s, composite_score / sources.length])),
});

// ---------------------------------------------------------------------------
// laneComposition / formatLaneComposition (2026-08-05, root-cause instrumentation)
// ---------------------------------------------------------------------------

test("laneComposition: ticker count and score share per lane, summing to 100%", () => {
  const rows = [
    row("A", 80, ["flow"], { flow: 80 }),
    row("B", 20, ["breakout"], { breakout: 20 }),
  ];
  const comp = laneComposition(rows, ["flow", "breakout", "catalyst"]);
  assert.deepEqual(comp.flow, { tickers: 1, scorePct: 80 });
  assert.deepEqual(comp.breakout, { tickers: 1, scorePct: 20 });
  assert.deepEqual(comp.catalyst, { tickers: 0, scorePct: 0 });
});

test("laneComposition: a multi-source row contributes to every lane it touched", () => {
  const rows = [row("STACK", 100, ["flow", "breakout"], { flow: 60, breakout: 40 })];
  const comp = laneComposition(rows, ["flow", "breakout"]);
  assert.equal(comp.flow!.tickers, 1);
  assert.equal(comp.breakout!.tickers, 1);
  assert.equal(comp.flow!.scorePct, 60);
  assert.equal(comp.breakout!.scorePct, 40);
});

test("laneComposition: empty pool → every lane at 0", () => {
  const comp = laneComposition([], ["flow", "breakout"]);
  assert.deepEqual(comp.flow, { tickers: 0, scorePct: 0 });
  assert.deepEqual(comp.breakout, { tickers: 0, scorePct: 0 });
});

test("formatLaneComposition: compact one-line rendering", () => {
  const comp = { flow: { tickers: 5, scorePct: 40 }, breakout: { tickers: 2, scorePct: 10 } };
  assert.equal(formatLaneComposition(comp), "flow=5t/40% breakout=2t/10%");
});

// ---------------------------------------------------------------------------
// applyConfluenceGate (2026-08-05, discovery-architecture redesign)
// ---------------------------------------------------------------------------

test("applyConfluenceGate: protected top admits single-lane names unconditionally", () => {
  const rows = [
    row("TOP1", 100, ["flow"]),
    row("TOP2", 90, ["catalyst"]),
  ];
  const gated = applyConfluenceGate(rows, 10, 2, 2);
  assert.deepEqual(gated.map((r) => r.ticker), ["TOP1", "TOP2"]);
});

test("applyConfluenceGate: below the protected top, single-lane names are dropped", () => {
  const rows = [
    row("PROTECTED", 100, ["flow"]), // rank 0, inside protectedTop=1
    row("SINGLE_LANE", 90, ["catalyst"]), // rank 1, single-lane, below protected top → dropped
    row("MULTI_LANE", 80, ["flow", "breakout"]), // rank 2, source_count=2 → admitted
  ];
  const gated = applyConfluenceGate(rows, 10, 1, 2);
  assert.deepEqual(gated.map((r) => r.ticker), ["PROTECTED", "MULTI_LANE"]);
});

test("applyConfluenceGate: stops once maxTickers admitted, preserving score order", () => {
  const rows = [
    row("A", 100, ["flow", "breakout"]),
    row("B", 90, ["flow", "catalyst"]),
    row("C", 80, ["flow", "movers"]),
  ];
  const gated = applyConfluenceGate(rows, 2, 0, 2);
  assert.deepEqual(gated.map((r) => r.ticker), ["A", "B"]);
});

test("applyConfluenceGate: never re-sorts — order-preserving filter only", () => {
  const rows = [
    row("A", 100, ["flow", "breakout"]),
    row("B", 90, ["flow"]), // single-lane, below protected top of 0 → dropped
    row("C", 80, ["flow", "catalyst"]),
  ];
  const gated = applyConfluenceGate(rows, 10, 0, 2);
  assert.deepEqual(gated.map((r) => r.ticker), ["A", "C"], "B dropped, A/C keep their relative order");
});

test("applyConfluenceGate: default params match the exported constants", () => {
  const rows = Array.from({ length: CONFLUENCE_PROTECTED_TOP + 5 }, (_, i) =>
    row(`T${i}`, 100 - i, i < CONFLUENCE_PROTECTED_TOP + 3 ? ["flow"] : ["flow", "breakout"])
  );
  const gated = applyConfluenceGate(rows, 100);
  // Everything inside the protected top is admitted regardless of source_count; single-lane
  // names ranked at/after the protected top (but before the multi-lane ones further down) are
  // dropped unless they clear CONFLUENCE_MIN_SOURCES.
  const admittedTickers = new Set(gated.map((r) => r.ticker));
  for (let i = 0; i < CONFLUENCE_PROTECTED_TOP; i++) assert.ok(admittedTickers.has(`T${i}`), `T${i} in protected top`);
  assert.ok(!admittedTickers.has(`T${CONFLUENCE_PROTECTED_TOP}`), "first single-lane name past the protected top is dropped");
  // A single-lane row exactly one below CONFLUENCE_MIN_SOURCES is dropped; a row exactly at it
  // is kept — pins the constant's actual value rather than just documenting it in a comment.
  const atThreshold = row("AT_THRESHOLD", 1, Array(CONFLUENCE_MIN_SOURCES).fill("flow-lane"));
  const belowThreshold = row("BELOW_THRESHOLD", 0.5, Array(CONFLUENCE_MIN_SOURCES - 1).fill("flow-lane"));
  const thresholdGated = applyConfluenceGate([atThreshold, belowThreshold], 100, 0);
  assert.deepEqual(thresholdGated.map((r) => r.ticker), ["AT_THRESHOLD"]);
});

test("applyConfluenceGate: empty input → empty output", () => {
  assert.deepEqual(applyConfluenceGate([], 60), []);
});
