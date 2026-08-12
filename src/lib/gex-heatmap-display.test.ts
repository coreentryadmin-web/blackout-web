import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fmtHeatmapMoney,
  fmtHeatmapMoneySigned,
  heatmapCellStyle,
  heatmapCellTextStyle,
  heatmapMatrixExtremeCellStyle,
} from "./gex-heatmap-display";

describe("gex-heatmap-display", () => {
  it("fmtHeatmapMoneySigned shows $0.0K at zero when showZero", () => {
    assert.equal(fmtHeatmapMoneySigned(0, { showZero: true }), "$0.0K");
    assert.equal(fmtHeatmapMoneySigned(0), "·");
  });

  it("fmtHeatmapMoney compacts magnitudes (canonical fmtPremium: $10K+ rounds to whole K)", () => {
    assert.equal(fmtHeatmapMoney(22_100), "$22K");
    assert.equal(fmtHeatmapMoney(4_200), "$4.2K");
    assert.equal(fmtHeatmapMoney(-45_200_000), "-$45.2M");
  });

  it("heatmapCellStyle supports dex/charm lenses", () => {
    const dex = heatmapCellStyle(1_000, 2_000, "dex");
    assert.match(String(dex.backgroundColor), /34,\s*211,\s*238/);
    const charm = heatmapCellStyle(-1_000, 2_000, "charm");
    assert.match(String(charm.backgroundColor), /255,\s*45,\s*85/);
  });

  it("heatmapMatrixExtremeCellStyle uses bead yellow / purple", () => {
    const pos = heatmapMatrixExtremeCellStyle("positive");
    assert.match(String(pos.backgroundColor), /255,\s*214,\s*10/);
    const neg = heatmapMatrixExtremeCellStyle("negative");
    assert.match(String(neg.backgroundColor), /217,\s*123,\s*255/);
  });

  it("heatmapCellTextStyle switches to white on deep cells", () => {
    const deep = heatmapCellTextStyle(900, 1_000);
    assert.equal(deep.color, "#ffffff");
    const light = heatmapCellTextStyle(100, 1_000);
    assert.equal(light.color, undefined);
    assert.ok(light.textShadow);
  });
});
/**
 * ABSENT IS NOT ZERO.
 *
 * The matrix coerces a missing cell to 0 before rendering (`const val = has ? v : 0`) and used to
 * pass `showZero: true` unconditionally, so a strike/expiry with NO listed contract printed
 * "$0.0K" — a measured reading where there is no instrument. On SPY that was a large share of the
 * grid. The formatter always supported both; only the call site was wrong (it now passes `has`).
 */

describe("absent vs measured zero", () => {
  it("a measured zero still reads as a measured zero", () => {
    assert.equal(fmtHeatmapMoneySigned(0, { showZero: true }), "$0.0K");
  });

  it("an absent cell reads as absent, not as zero", () => {
    assert.equal(fmtHeatmapMoneySigned(0, { showZero: false }), "·");
    assert.equal(fmtHeatmapMoneySigned(0), "·");
  });

  it("real values are unaffected and keep their sign", () => {
    assert.match(fmtHeatmapMoneySigned(1_500_000, { showZero: false }), /^\+\$1\.5M$/);
    assert.match(fmtHeatmapMoneySigned(-1_500_000, { showZero: true }), /^-\$1\.5M$/);
  });
});
