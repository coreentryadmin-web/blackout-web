import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECTION = readFileSync(
  join(process.cwd(), "src/lib/largo/gex-heatmap-for-largo.ts"),
  "utf8",
);
const THERMAL = readFileSync(
  join(process.cwd(), "src/features/thermal/components/GexHeatmap.tsx"),
  "utf8",
);
const SPX = readFileSync(
  join(process.cwd(), "src/features/spx/components/SpxGexMatrixHeatmap.tsx"),
  "utf8",
);

const CODE = PROJECTION.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("REGRESSION: Largo projection carries chain_truncated from the heatmap", () => {
  assert.match(CODE, /chain_truncated\?: boolean/);
  assert.match(CODE, /hm\.chain_truncated/);
});

test("the empty/degraded branch declares chain_truncated too", () => {
  const nullBranch = CODE.slice(0, CODE.indexOf("top_strikes: topStrikesFromTotals"));
  assert.match(nullBranch, /chain_truncated:\s*undefined/);
});

test("Thermal matrix surfaces chain_truncated to members", () => {
  assert.match(THERMAL, /chain_truncated\?: boolean/);
  assert.match(THERMAL, /data\?\.chain_truncated/);
});

test("SPX Slayer matrix rail surfaces chain_truncated to members", () => {
  assert.match(SPX, /chain_truncated\?: boolean/);
  assert.match(SPX, /data\?\.chain_truncated/);
});

test("get_gex_heatmap tool description tells Largo to cite truncation", () => {
  const defs = readFileSync(join(process.cwd(), "src/lib/largo/tool-defs.ts"), "utf8");
  assert.match(defs, /chain_truncated/);
});
