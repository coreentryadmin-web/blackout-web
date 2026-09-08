import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeGreeksDistribution, topGammaBuckets } from "./greeks-distribution";
import type { GexCells } from "./per-expiry-levels";

describe("greeks-distribution", () => {
  it("analyzeGreeksDistribution handles empty cells gracefully", () => {
    const result = analyzeGreeksDistribution({}, 5550, 0.03);
    assert.equal(result.buckets.length, 0);
    assert.equal(result.totalAbsGamma, 0);
    assert.equal(result.concentrationStrikes.length, 0);
    assert.equal(result.clusterCount, 0);
    assert.equal(result.maxGap, 0);
  });

  it("analyzeGreeksDistribution handles invalid spot gracefully", () => {
    const cells: GexCells = { "5550": { "2026-09-19": 1000 } };
    assert.deepEqual(analyzeGreeksDistribution(cells, 0, 0.03).buckets, []);
    assert.deepEqual(analyzeGreeksDistribution(cells, -100, 0.03).buckets, []);
    assert.deepEqual(analyzeGreeksDistribution(cells, NaN, 0.03).buckets, []);
  });

  it("analyzeGreeksDistribution aggregates across expiries", () => {
    const cells: GexCells = {
      "5550": { "2026-09-19": 1000, "2026-10-17": 500 },
      "5555": { "2026-09-19": 500 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    assert.equal(result.totalAbsGamma, 2000);
    assert.equal(result.buckets.length, 2);

    const strike5550 = result.buckets.find((b) => b.strike === 5550);
    assert.ok(strike5550);
    assert.equal(strike5550.absGamma, 1500); // 1000 + 500
    assert.equal(strike5550.pctOfTotal, 75);

    const strike5555 = result.buckets.find((b) => b.strike === 5555);
    assert.ok(strike5555);
    assert.equal(strike5555.absGamma, 500);
    assert.equal(strike5555.pctOfTotal, 25);
  });

  it("analyzeGreeksDistribution respects band limits", () => {
    const cells: GexCells = {
      "5300": { "2026-09-19": 1000 }, // Outside 3% band (lo=5383.5)
      "5550": { "2026-09-19": 1000 }, // At spot
      "5800": { "2026-09-19": 1000 }, // Outside 3% band (hi=5716.5)
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    // Only 5550 should be included
    assert.equal(result.buckets.length, 1);
    assert.equal(result.buckets[0].strike, 5550);
  });

  it("analyzeGreeksDistribution detects concentration (>10% of total)", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 1000 },
      "5550": { "2026-09-19": 9000 }, // 90% of total
      "5555": { "2026-09-19": 1000 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    const concentrated = result.buckets.find((b) => b.strike === 5550);
    assert.ok(concentrated);
    assert.equal(concentrated.isConcentration, true);
    assert.deepEqual(result.concentrationStrikes, [5550]);
  });

  it("analyzeGreeksDistribution marks clustering near concentration", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 100 },
      "5545": { "2026-09-19": 200 },
      "5550": { "2026-09-19": 5000 }, // concentration
      "5555": { "2026-09-19": 200 },
      "5560": { "2026-09-19": 100 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    const clustered = result.buckets.filter((b) => b.isClustered);
    assert.ok(clustered.length > 1, "Multiple strikes should be marked as clustered");
    assert.ok(clustered.some((b) => b.strike === 5550), "Concentration strike should be clustered");
    assert.ok(clustered.some((b) => b.strike === 5545), "Nearby strike should be clustered");
  });

  it("analyzeGreeksDistribution identifies gaps", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 1000 },
      "5545": { "2026-09-19": 1000 },
      // 10 point gap
      "5555": { "2026-09-19": 1000 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    assert.equal(result.maxGap, 10);
    assert.equal(result.gapStrikes.length, 1);
    assert.equal(result.gapStrikes[0].from, 5545);
    assert.equal(result.gapStrikes[0].to, 5555);
    assert.equal(result.gapStrikes[0].gap, 10);
  });

  it("analyzeGreeksDistribution counts clusters correctly", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 800 },
      "5545": { "2026-09-19": 700 }, // Cluster 1
      // gap
      "5555": { "2026-09-19": 600 },
      "5560": { "2026-09-19": 500 }, // Cluster 2
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    assert.ok(result.clusterCount >= 1, "Should detect at least one cluster");
  });

  it("analyzeGreeksDistribution counts two separated walls as TWO clusters, not one", () => {
    // Two dominant strikes (~49% each) with three quiet strikes between them. `buckets` is
    // sorted by gamma MAGNITUDE internally — the two big strikes are equal, so a stable sort
    // keeps them adjacent to each other in that order (both rank ahead of the three quiet
    // strikes), which would make a magnitude-order walk see them as ONE consecutive run.
    // Walking in STRIKE-PRICE order (the fix) correctly sees two runs separated by three
    // strikes below the 5% threshold.
    const cells: GexCells = {
      "5630": { "2026-09-19": 5000 },
      "5640": { "2026-09-19": 50 },
      "5650": { "2026-09-19": 50 },
      "5660": { "2026-09-19": 50 },
      "5670": { "2026-09-19": 5000 },
    };
    const result = analyzeGreeksDistribution(cells, 5650, 0.03);
    assert.equal(result.clusterCount, 2, "Two strikes separated by three quiet strikes are two clusters, not one");
  });

  it("analyzeGreeksDistribution: a strike adjacent (in price) to a wall is clustered, even if it ranks far from that wall by exposure", () => {
    // Same fixture as above. 5660 sits one strike below the 5670 wall — it must read as
    // clustered. The bug computed "within 2 strikes" using gamma-MAGNITUDE-rank position
    // instead of strike-PRICE position, under which 5660 ranked far from both walls and was
    // wrongly marked NOT clustered.
    const cells: GexCells = {
      "5630": { "2026-09-19": 5000 },
      "5640": { "2026-09-19": 50 },
      "5650": { "2026-09-19": 50 },
      "5660": { "2026-09-19": 50 },
      "5670": { "2026-09-19": 5000 },
    };
    const result = analyzeGreeksDistribution(cells, 5650, 0.03);
    const strike5660 = result.buckets.find((b) => b.strike === 5660);
    assert.ok(strike5660);
    assert.equal(strike5660.isClustered, true, "5660 is one strike from the 5670 wall — must be clustered");
  });

  it("analyzeGreeksDistribution calculates exposure spread", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 5000 },
      "5545": { "2026-09-19": 3000 },
      "5550": { "2026-09-19": 1000 },
      "5555": { "2026-09-19": 500 },
      "5560": { "2026-09-19": 200 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    assert.ok(result.exposureSpread > 0);
    assert.ok(result.exposureSpread < 100);
  });

  it("analyzeGreeksDistribution ranks by exposure descending", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 100 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": 1000 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    assert.equal(result.buckets[0].strike, 5545); // sorted by strike
    const ranked = [...result.buckets].sort((a, b) => a.rank - b.rank);
    assert.equal(ranked[0].strike, 5550, "Rank 1 should be highest exposure");
    assert.equal(ranked[0].absGamma, 5000);
    assert.equal(ranked[1].strike, 5555, "Rank 2 should be second highest");
    assert.equal(ranked[2].strike, 5545, "Rank 3 should be third highest");
  });

  it("analyzeGreeksDistribution handles negative gamma (sums absolute value)", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": -1000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": -500 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    assert.equal(result.totalAbsGamma, 6500);
    const strike5545 = result.buckets.find((b) => b.strike === 5545);
    assert.equal(strike5545?.absGamma, 1000); // absolute value
  });

  it("analyzeGreeksDistribution ignores non-finite values", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 1000, "2026-10-17": NaN },
      "5550": { "2026-09-19": 1000, "2026-10-17": Infinity },
      "5555": { "2026-09-19": 1000, "2026-10-17": -Infinity },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    assert.equal(result.totalAbsGamma, 3000); // Only valid values
  });

  it("analyzeGreeksDistribution returns buckets sorted by strike", () => {
    const cells: GexCells = {
      "5560": { "2026-09-19": 100 },
      "5545": { "2026-09-19": 200 },
      "5555": { "2026-09-19": 150 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    const strikes = result.buckets.map((b) => b.strike);
    assert.deepEqual(strikes, [5545, 5555, 5560]);
  });

  it("analyzeGreeksDistribution handles single strike", () => {
    const cells: GexCells = {
      "5550": { "2026-09-19": 5000 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    assert.equal(result.buckets.length, 1);
    assert.equal(result.buckets[0].pctOfTotal, 100);
    assert.equal(result.exposureSpread, 0);
  });

  it("analyzeGreeksDistribution tracks percentage correctly", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 2000 },
      "5550": { "2026-09-19": 3000 },
      "5555": { "2026-09-19": 5000 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    const pcts = result.buckets.map((b) => b.pctOfTotal);
    const sum = pcts.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 0.01, "Percentages should sum to ~100");
  });

  it("topGammaBuckets must not mutate the caller's strike-ascending buckets array (GreeksDistributionPanel reads analysis.buckets again on every re-render)", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 1000 },
      "5545": { "2026-09-19": 2000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": 1500 },
      "5560": { "2026-09-19": 500 },
    };
    const result = analyzeGreeksDistribution(cells, 5550, 0.03);
    const strikeAscending = [5540, 5545, 5550, 5555, 5560];
    assert.deepEqual(
      result.buckets.map((b) => b.strike),
      strikeAscending,
      "documented contract: buckets is strike-ascending"
    );

    const top5 = topGammaBuckets(result.buckets);
    assert.equal(top5[0].strike, 5550, "top5 is gamma-ranked, unrelated to buckets' own order");
    assert.deepEqual(
      result.buckets.map((b) => b.strike),
      strikeAscending,
      "selecting a gamma-ranked view must not reorder the original strike-ascending buckets"
    );
  });
});
