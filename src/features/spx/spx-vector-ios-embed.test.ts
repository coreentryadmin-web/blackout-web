import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("SpxDashboard unmounts Vector embed when iOS segment leaves Vector tab", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/components/SpxDashboard.tsx"), "utf8");
  assert.match(src, /!compactPanels \|\| iosPanel === "vector"/);
  assert.match(src, /selectIosPanel/);
  assert.match(src, /spx-sniper-desk--ios-vector-focus/);
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

test("SpxVectorEmbed bootstraps client seed with bars, walls, and wall history", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/components/SpxVectorEmbed.tsx"), "utf8");
  assert.match(src, /fetchVectorClientSeed\("SPX"\)/);
  assert.match(src, /initialWallHistory=\{seed\.wallHistory\}/);
  assert.match(src, /liveSession=\{liveSession\}/);
  assert.doesNotMatch(src, /sessionYmd=\{todayEtYmd\(\)\}/);
});

test("VectorChart empty-state banner tracks live sessionBars not static initialBars", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");
  assert.match(src, /!sessionBars\.length/);
});
