import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeThetaDistribution } from "./theta-distribution";
import type { GexCells } from "./per-expiry-levels";

describe("theta-distribution", () => {
  it("returns empty analysis for null cells", () => {
    const result = analyzeThetaDistribution(null as any, 500, 0.03);
    assert.equal(result.buckets.length, 0);
    assert.equal(result.totalAbsCharm, 0);
    assert.equal(result.netCharm, 0);
    assert.equal(result.pinBias, "neutral");
  });

  it("returns empty analysis for invalid spot", () => {
    const cells: GexCells = {
      "500": { expiry1: 1000, expiry2: 500 },
    };
    const result = analyzeThetaDistribution(cells, 0, 0.03);
    assert.equal(result.buckets.length, 0);
    assert.equal(result.totalAbsCharm, 0);
  });

  it("analyzes charm distribution within band", () => {
    const cells: GexCells = {
      "490": { expiry1: -500 },
      "495": { expiry1: 1000 },
      "500": { expiry1: 2000 },
      "505": { expiry1: -1000 },
      "510": { expiry1: 500 },
      "600": { expiry1: 5000 }, // outside band
    };

    const result = analyzeThetaDistribution(cells, 500, 0.03);
    assert.equal(result.buckets.length, 5);
    assert.equal(result.totalAbsCharm, 5000);
    assert.equal(result.netCharm, 2000);
  });

  it("identifies concentration strikes (>10%)", () => {
    const cells: GexCells = {
      "495": { expiry1: 500 },
      "500": { expiry1: 5500 },
      "505": { expiry1: 4000 },
    };

    const result = analyzeThetaDistribution(cells, 500, 0.03);
    assert.ok(result.concentrationStrikes.includes(500));
    assert.ok(result.concentrationStrikes.includes(505)); // 4000/10000 = 40% > 10%
    assert.equal(result.concentrationStrikes.length, 2);
  });

  it("identifies pin-up strikes (positive charm >5%)", () => {
    const cells: GexCells = {
      "495": { expiry1: -1000 },
      "500": { expiry1: 3000 },
      "505": { expiry1: 2000 },
    };

    const result = analyzeThetaDistribution(cells, 500, 0.03);
    assert.ok(result.pinUpStrikes.includes(500));
    assert.ok(result.pinUpStrikes.includes(505));
    assert.ok(result.pinDownStrikes.includes(495));
  });

  it("determines pin bias", () => {
    const cellsUpBias: GexCells = {
      "495": { expiry1: 1000 },
      "500": { expiry1: 3000 },
      "505": { expiry1: 1000 },
    };
    assert.equal(analyzeThetaDistribution(cellsUpBias, 500, 0.03).pinBias, "up");

    const cellsDownBias: GexCells = {
      "495": { expiry1: -3000 },
      "500": { expiry1: -1000 },
      "505": { expiry1: -1000 },
    };
    assert.equal(analyzeThetaDistribution(cellsDownBias, 500, 0.03).pinBias, "down");

    const cellsNeutral: GexCells = {
      "495": { expiry1: -1000 },
      "500": { expiry1: 1000 },
      "505": { expiry1: 500 },
    };
    assert.equal(analyzeThetaDistribution(cellsNeutral, 500, 0.03).pinBias, "neutral");
  });

  it("identifies gaps >5 points", () => {
    const cells: GexCells = {
      "490": { expiry1: 100 },
      "495": { expiry1: 200 },
      "508": { expiry1: 300 },
      "509": { expiry1: 100 },
    };

    const result = analyzeThetaDistribution(cells, 500, 0.05);
    const gapFound = result.gapStrikes.some((g) => g.from === 495 && g.to === 508 && g.gap === 13);
    assert.ok(gapFound);
    assert.equal(result.maxGap, 13);
  });

  it("handles multi-expiry charm aggregation", () => {
    const cells: GexCells = {
      "500": {
        expiry1: 1000,
        expiry2: -500,
        expiry3: 1500,
      },
      "505": {
        expiry1: 500,
        expiry2: 500,
      },
    };

    const result = analyzeThetaDistribution(cells, 500, 0.03);
    const bucket500 = result.buckets.find((b) => b.strike === 500);
    assert.ok(bucket500);
    assert.equal(bucket500.charmSign, 2000);
    assert.equal(bucket500.absCharm, 2000);
  });

  it("ranks buckets by absolute charm", () => {
    const cells: GexCells = {
      "490": { expiry1: 500 },
      "495": { expiry1: 2000 },
      "500": { expiry1: -3000 },
      "505": { expiry1: 1000 },
    };

    const result = analyzeThetaDistribution(cells, 500, 0.03);
    const sortedByRank = result.buckets.sort((a, b) => a.rank - b.rank);
    assert.equal(sortedByRank[0]?.strike, 500);
    assert.equal(sortedByRank[1]?.strike, 495);
    assert.equal(sortedByRank[2]?.strike, 505);
  });
});
