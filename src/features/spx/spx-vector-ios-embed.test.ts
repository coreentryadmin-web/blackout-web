import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("SpxDashboard unmounts Vector embed when iOS segment leaves Vector tab", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/components/SpxDashboard.tsx"), "utf8");
  assert.match(src, /!compactPanels \|\| iosPanel === "vector"/);
  assert.match(src, /key="spx-vector-embed"/);
});

test("VectorChart supports fillHost embed mode without standalone viewport height", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");
  assert.match(src, /fillHost\?: boolean/);
  assert.match(src, /vector-chart-canvas--fill-host/);
  assert.match(src, /layoutObserver = new ResizeObserver/);
});

test("VectorPageShell passes fillHost for chart-only SPX embed", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorPageShell.tsx"), "utf8");
  assert.match(src, /fillHost/);
});
