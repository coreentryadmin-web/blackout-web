import test from "node:test";
import assert from "node:assert/strict";
import { classifyLossBucket, segmentTaxonomy, flagDivergentSegments } from "./swing-loss-taxonomy-segment-eval.mjs";

test("classifyLossBucket: a win (exitPnlPct >= 0) is always WIN regardless of MFE", () => {
  assert.equal(classifyLossBucket({ entryPremium: 10, peakPremium: 25, exitPnlPct: 5 }), "WIN");
  assert.equal(classifyLossBucket({ entryPremium: 10, peakPremium: 10, exitPnlPct: 0 }), "WIN");
});

test("classifyLossBucket: a loss with big MFE (>=10%) that round-tripped is BAD_EXIT", () => {
  // IGV-shaped: +14.6% MFE, closed at a loss.
  assert.equal(classifyLossBucket({ entryPremium: 10, peakPremium: 11.46, exitPnlPct: -39.49 }), "BAD_EXIT");
});

test("classifyLossBucket: a loss with near-zero MFE (<5%) never had real edge — BAD_ENTRY", () => {
  assert.equal(classifyLossBucket({ entryPremium: 10, peakPremium: 10.2, exitPnlPct: -40 }), "BAD_ENTRY");
  assert.equal(classifyLossBucket({ entryPremium: 10, peakPremium: 9.5, exitPnlPct: -20 }), "BAD_ENTRY"); // MFE can't be negative in practice but guard non-strict
});

test("classifyLossBucket: a loss with MFE in the ambiguous 5-10% middle is VARIANCE, not forced either way", () => {
  assert.equal(classifyLossBucket({ entryPremium: 10, peakPremium: 10.7, exitPnlPct: -15 }), "VARIANCE");
});

test("classifyLossBucket: missing any of the three inputs is unclassifiable (null), never guessed", () => {
  assert.equal(classifyLossBucket({ entryPremium: null, peakPremium: 11, exitPnlPct: -10 }), null);
  assert.equal(classifyLossBucket({ entryPremium: 10, peakPremium: null, exitPnlPct: -10 }), null);
  assert.equal(classifyLossBucket({ entryPremium: 10, peakPremium: 11, exitPnlPct: null }), null);
  assert.equal(classifyLossBucket({ entryPremium: 0, peakPremium: 11, exitPnlPct: -10 }), null);
});

test("segmentTaxonomy: groups by key, reports per-segment counts + loss rate, and the aggregate", () => {
  const classified = [
    { key: "BREAKOUT", bucket: "BAD_EXIT" },
    { key: "BREAKOUT", bucket: "BAD_EXIT" },
    { key: "BREAKOUT", bucket: "WIN" },
    { key: "MEAN_REVERSION", bucket: "WIN" },
    { key: "MEAN_REVERSION", bucket: "WIN" },
  ];
  const result = segmentTaxonomy(classified, { minN: 2 });
  assert.equal(result.totalN, 5);
  assert.equal(result.droppedUnclassifiable, 0);
  const breakout = result.segments.find((s) => s.key === "BREAKOUT");
  assert.equal(breakout.n, 3);
  assert.equal(breakout.counts.BAD_EXIT, 2);
  assert.equal(breakout.lossRatePct, Math.round((2 / 3) * 1000) / 10);
  assert.equal(breakout.thin, false);
  const meanRev = result.segments.find((s) => s.key === "MEAN_REVERSION");
  assert.equal(meanRev.lossRatePct, 0);
});

test("segmentTaxonomy: a segment below minN is still reported (real n), flagged thin, never dropped", () => {
  const classified = [
    { key: "RARE_ARCHETYPE", bucket: "BAD_ENTRY" },
    { key: "COMMON", bucket: "WIN" },
    { key: "COMMON", bucket: "WIN" },
    { key: "COMMON", bucket: "WIN" },
    { key: "COMMON", bucket: "WIN" },
    { key: "COMMON", bucket: "WIN" },
  ];
  const result = segmentTaxonomy(classified, { minN: 5 });
  const rare = result.segments.find((s) => s.key === "RARE_ARCHETYPE");
  assert.equal(rare.n, 1);
  assert.equal(rare.thin, true);
  assert.equal(rare.lossRatePct, 100);
});

test("segmentTaxonomy: unclassifiable/null-key rows are excluded from segments AND from totalN", () => {
  const classified = [
    { key: "BREAKOUT", bucket: "WIN" },
    { key: "BREAKOUT", bucket: null },
    { key: null, bucket: "BAD_EXIT" },
  ];
  const result = segmentTaxonomy(classified, { minN: 1 });
  assert.equal(result.totalN, 1);
  assert.equal(result.droppedUnclassifiable, 2);
  assert.equal(result.segments.length, 1);
});

test("flagDivergentSegments: a large, non-thin divergence from the aggregate is flagged with its signed delta", () => {
  const classified = [
    ...Array.from({ length: 5 }, () => ({ key: "BAD_ARCHETYPE", bucket: "BAD_EXIT" })),
    ...Array.from({ length: 5 }, () => ({ key: "GOOD_ARCHETYPE", bucket: "WIN" })),
  ];
  const seg = segmentTaxonomy(classified, { minN: 5 });
  const flagged = flagDivergentSegments(seg, { deltaPp: 20, minN: 5 });
  assert.equal(flagged.length, 2);
  const bad = flagged.find((s) => s.key === "BAD_ARCHETYPE");
  assert.equal(bad.lossRatePct, 100);
  assert.ok(bad.deltaFromAggregatePp > 0);
  const good = flagged.find((s) => s.key === "GOOD_ARCHETYPE");
  assert.ok(good.deltaFromAggregatePp < 0);
});

test("flagDivergentSegments: a thin segment is never flagged even if its own rate looks extreme", () => {
  const classified = [
    { key: "THIN", bucket: "BAD_EXIT" },
    ...Array.from({ length: 10 }, () => ({ key: "COMMON", bucket: "WIN" })),
  ];
  const seg = segmentTaxonomy(classified, { minN: 5 });
  const flagged = flagDivergentSegments(seg, { deltaPp: 20, minN: 5 });
  assert.equal(flagged.find((s) => s.key === "THIN"), undefined);
});

test("flagDivergentSegments: a segment close to the aggregate rate is not flagged", () => {
  const classified = [
    ...Array.from({ length: 3 }, () => ({ key: "A", bucket: "WIN" })),
    ...Array.from({ length: 2 }, () => ({ key: "A", bucket: "BAD_EXIT" })),
    ...Array.from({ length: 3 }, () => ({ key: "B", bucket: "WIN" })),
    ...Array.from({ length: 2 }, () => ({ key: "B", bucket: "BAD_ENTRY" })),
  ];
  const seg = segmentTaxonomy(classified, { minN: 5 });
  const flagged = flagDivergentSegments(seg, { deltaPp: 20, minN: 5 });
  assert.deepEqual(flagged, []);
});
