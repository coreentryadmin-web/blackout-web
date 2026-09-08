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

// Regression for a P1 finding (2026-09-02): `vectorEnabled` is fed by canAccessTool("vector"),
// which combines the GLOBAL launch flag (unconditionally true — Vector shipped, see
// src/lib/tool-access.ts's TOOLS entry) with PER-USER tier/tool_access overrides. So this
// fallback can only render for a reason that has nothing to do with launch status — an
// SPX-Slayer-only (non-Premium) member's plan simply doesn't include Vector. The old copy
// ("Vector chart launching soon") claimed the whole product wasn't built yet, which was false —
// Vector has a fully built universe screener, GEX ladder, regime banner, wall-integrity scoring,
// confluence zones, alerts, and replay in production. Misdiagnosing an entitlement gate as an
// incomplete-feature gate gives a paying member the wrong reason and no path forward.
test("SPX Dashboard's Vector-disabled fallback names the plan gate, not a launch-status claim, and offers an upgrade path", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/components/SpxDashboard.tsx"), "utf8");
  assert.doesNotMatch(src, /launching soon/i, "must not claim Vector itself is unlaunched — it ships live by default");
  assert.match(src, /isn't on your plan/i);
  assert.match(src, /Button href="\/upgrade"/);
});
