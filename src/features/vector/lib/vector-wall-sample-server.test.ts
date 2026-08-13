import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
  ORACLE_WALL_TRAIL_SAMPLE_SEC,
  UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
} from "./vector-wall-sample";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";

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
  // A genuinely on-demand ticker — nothing records it in the background, so its rail really is
  // viewer-built and 15s is the honest cadence for it.
  //
  // Resolved from the universe at RUNTIME rather than hardcoded. This assertion used to name
  // PLTR, which stopped being on-demand the moment PLTR joined the static overlay/record universe
  // with the Thermal sector grid — and the failure then read "5 !== 15", which describes the
  // symptom and hides the cause. Picking the example from the live list means a future universe
  // change either finds another off-universe name or fails on the explicit premise below.
  const offUniverse = ["F", "SOFI", "NIO", "PFE", "T"].find((t) => !vectorUniverseTickers().includes(t));
  assert.ok(
    offUniverse,
    "every candidate is now IN the recorded universe — pick a new off-universe ticker for this case"
  );
  assert.equal(wallTrailSampleSecForTicker(offUniverse), NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker(null), NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
});

test("wallTrailSampleSecForTicker: a RECORDED-universe ticker gets 5s in live scope too", async () => {
  const { wallTrailSampleSecForTicker } = await mod();
  // This assertion used to read NON_UNIVERSE (15s), which is what the bug looked like from
  // inside the unit test: it faithfully described the function and said nothing about the rail.
  //
  // NVDA/TSLA/AMD are in the static shared universe, so the background recorder is ALREADY
  // stamping their rail at 5s. The SSE hub then wrote the same rail at 15s, and since both
  // writers key by bucket time the coarser bucket swallowed two of every three observations.
  // Measured on prod over one 77-minute window: SPX 614 samples / 5s median gap vs NVDA 207 / 15s
  // and TSLA 115 / 30s — with every one of those names already captured at 5s upstream.
  //
  // The cadence belongs to the RAIL. Two writers on one rail must agree about it.
  for (const t of ["NVDA", "TSLA", "AMD", "META", "AAPL"]) {
    assert.equal(
      wallTrailSampleSecForTicker(t),
      UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
      `${t} is recorded at 5s; the live writer must not re-stamp its rail at 15s`
    );
  }
});

test("wallTrailSampleSecForTicker: the env override still beats every ticker rule", async () => {
  const prev = process.env.VECTOR_WALL_TRAIL_SAMPLE_SEC;
  process.env.VECTOR_WALL_TRAIL_SAMPLE_SEC = "20";
  try {
    const { wallTrailSampleSecForTicker } = await mod();
    // The new universe branch sits AFTER the override, so an operator tuning cadence in prod is
    // not silently overruled for exactly the tickers this change touches.
    assert.equal(wallTrailSampleSecForTicker("NVDA"), 20);
    assert.equal(wallTrailSampleSecForTicker("SPX"), 20);
    assert.equal(wallTrailSampleSecForTicker("PLTR", "universe"), 20);
  } finally {
    if (prev == null) delete process.env.VECTOR_WALL_TRAIL_SAMPLE_SEC;
    else process.env.VECTOR_WALL_TRAIL_SAMPLE_SEC = prev;
  }
});
