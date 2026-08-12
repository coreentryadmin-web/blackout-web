import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fmtHeatmapMoney,
  fmtHeatmapMoneySigned,
  heatmapCellStyle,
  heatmapCellTextStyle,
  heatmapMatrixExtremeCellStyle,
  heatmapLegendItems,
  GEX_BEAD_CALL_HEX,
  GEX_BEAD_PUT_HEX,
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

/**
 * The matrix encodes five things in colour and, until the legend existed, explained none of them.
 * These tests guard the property that actually matters — that the key is DERIVED from the same
 * constants the cells are painted from — rather than the wording, which is free to change.
 */
describe("matrix colour key", () => {
  const GEX = { noun: "Gamma", pos: "long γ", neg: "short γ" };

  it("covers every encoding a reader can see on the grid", () => {
    const items = heatmapLegendItems("gex", GEX);
    assert.equal(items.filter((i) => i.kind === "scale").length, 1);
    assert.equal(items.filter((i) => i.kind === "swatch").length, 2);
    assert.equal(items.filter((i) => i.kind === "empty").length, 1);
  });

  it("the peak swatches are the exact colours the peak cells are painted", () => {
    const swatches = heatmapLegendItems("gex", GEX).filter((i) => i.kind === "swatch");
    const hexes = swatches.map((s) => (s as { hex: string }).hex);
    // If these ever drift apart the key becomes a lie, which is worse than having no key.
    assert.deepEqual(hexes, [GEX_BEAD_CALL_HEX, GEX_BEAD_PUT_HEX]);
    assert.ok(heatmapMatrixExtremeCellStyle("positive").backgroundColor?.includes("255, 214, 10"));
    assert.ok(heatmapMatrixExtremeCellStyle("negative").backgroundColor?.includes("217, 123, 255"));
  });

  it("the scale tracks the lens — DEX is not painted in GEX's green", () => {
    const gex = heatmapLegendItems("gex", GEX)[0] as { toHex: string };
    const dex = heatmapLegendItems("dex", { noun: "Delta", pos: "long δ", neg: "short δ" })[0] as {
      toHex: string;
    };
    assert.equal(gex.toHex, "#00e676");
    assert.equal(dex.toHex, "#22d3ee");
    assert.notEqual(gex.toHex, dex.toHex);
  });

  it("speaks the lens's own nouns, not \"positive\" and \"negative\"", () => {
    const [scale] = heatmapLegendItems("vex", { noun: "Vanna", pos: "pos vanna", neg: "neg vanna" });
    assert.equal((scale as { posLabel: string }).posLabel, "pos vanna");
    assert.match((scale as { help: string }).help, /vanna/i);
  });

  it("distinguishes an absent cell from a measured zero — the pair #2085 fixed", () => {
    const empty = heatmapLegendItems("gex", GEX).find((i) => i.kind === "empty");
    assert.ok(empty);
    assert.equal((empty as { glyph: string }).glyph, fmtHeatmapMoneySigned(0, { showZero: false }));
    assert.match((empty as { help: string }).help, /\$0\.0K/);
  });
});
