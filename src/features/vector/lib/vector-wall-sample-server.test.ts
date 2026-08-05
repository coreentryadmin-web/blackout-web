import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
  ORACLE_WALL_TRAIL_SAMPLE_SEC,
  UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
} from "./vector-wall-sample";

// vector-wall-sample-server.ts now starts with `import "server-only";` (added alongside the
// no-restricted-imports ESLint guard against client components importing *-server modules —
// see docs/audit/FINDINGS.md 2026-08-05 / PR #1708). That guard throws under a plain `tsx --test`
// import ("cannot be imported from a Client Component"), so stub it out same as the
// src/features/spx/lib/*-server.test.ts files do — the real uw-socket import is left untouched
// since hasLiveGexStrikeExpiry() naturally returns false with no live WS state in-process.
mock.module("server-only", { namedExports: {} });

// Lazy dynamic import (not a static one) so the mock above is registered first — same
// pattern as src/features/spx/lib/spx-signal-log-catalyst-shadow.test.ts.
const mod = () => import("./vector-wall-sample-server");

test("wallTrailSampleSecForTicker: universe scope is always 5s", async () => {
  const { wallTrailSampleSecForTicker } = await mod();
  assert.equal(wallTrailSampleSecForTicker("PLTR", "universe"), UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("NVDA", "universe"), UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
});

test("wallTrailSampleSecForTicker: live scope — oracle 5s, on-demand 15s", async () => {
  const { wallTrailSampleSecForTicker } = await mod();
  assert.equal(wallTrailSampleSecForTicker("SPX"), ORACLE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("SPY"), ORACLE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("QQQ"), ORACLE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("NVDA"), NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("PLTR"), NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker(null), NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
});
