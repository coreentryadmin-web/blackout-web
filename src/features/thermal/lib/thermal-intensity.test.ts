import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  thermalIntensityBlockCount,
  thermalIntensityMarkerForRow,
  thermalIntensityRatio,
  thermalIntensityWidthPct,
} from "./thermal-intensity";

describe("thermalIntensityRatio", () => {
  test("scales to peak node", () => {
    assert.equal(thermalIntensityRatio(3.4e9, 7.3e9), 3.4 / 7.3);
    assert.equal(thermalIntensityRatio(7.3e9, 7.3e9), 1);
  });

  test("zero peak or zero value → 0", () => {
    assert.equal(thermalIntensityRatio(100, 0), 0);
    assert.equal(thermalIntensityRatio(0, 1e9), 0);
  });
});

describe("thermalIntensityWidthPct", () => {
  test("peak node fills track", () => {
    assert.equal(thermalIntensityWidthPct(1), 100);
  });

  test("small nodes get a visible floor", () => {
    assert.ok(thermalIntensityWidthPct(0.02) >= 2.5);
  });
});

describe("thermalIntensityBlockCount", () => {
  test("maps ratio to blocks", () => {
    assert.equal(thermalIntensityBlockCount(1, 22), 22);
    assert.ok(thermalIntensityBlockCount(0.5, 22) >= 10);
  });
});

describe("thermalIntensityMarkerForRow", () => {
  test("spot wins over wall", () => {
    assert.equal(
      thermalIntensityMarkerForRow({
        isSpot: true,
        isFlipStrike: false,
        isPosWall: true,
        isNegWall: false,
        isAnchor: false,
      }),
      "spot"
    );
  });

  test("flip beats walls", () => {
    assert.equal(
      thermalIntensityMarkerForRow({
        isSpot: false,
        isFlipStrike: true,
        isPosWall: true,
        isNegWall: false,
        isAnchor: false,
      }),
      "flip"
    );
  });
});
