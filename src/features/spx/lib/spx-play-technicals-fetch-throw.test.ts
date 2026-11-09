// REAL BEHAVIOR test for buildPlayTechnicals' error isolation around its bars/RSI fetch —
// mocking "@/lib/providers/polygon" per node:test's --experimental-test-module-mocks so the
// actual Promise.all + degrade-to-empty logic runs for real, not just a regex check against the
// source. Same established pattern as polygon-macro-fetch-failure.test.ts.
//
// BUG (live repro 2026-11-09, production, real RTH — confirmed `market_open:true`):
// buildPlayTechnicals() (spx-play-technicals.ts) calls
// `await Promise.all([fetchIndexMinuteBars(...), fetchIndexRsi(...)])` with no error isolation.
// fetchIndexRsi already guards itself (try/catch -> null on failure — see its own comment in
// polygon.ts: "polygonGet THROWS on a non-OK response, so a transient blip here would reject into
// callers instead of degrading to null"), but fetchIndexMinuteBars has NO such guard — a Polygon
// 403/429 propagates the raw throw straight out of buildPlayTechnicals, past
// evaluateSpxPlayState (whose caller only has try{...}finally{...}, no catch), into
// withServerCache's internal Promise.race, where a fast rejection wins the race before the
// timeout/fallback branch ever engages — skipping the configured `fallback: spxPlayReadFallback`
// entirely. The function ALREADY HAS a ready-made graceful `available:false` empty shape (used
// today when bars genuinely come back empty) — it just was never reachable on a THROW, only on an
// empty array. GET /api/market/spx/play was observed live returning score:0/factors:[]/
// assessed:false for ~5 minutes straight on 3 consecutive polls, cross-confirmed via
// GET /api/admin/cron-health showing the spx-evaluate cron's own direct buildPlayTechnicals call
// failing ~54% of 24h runs with the identical Polygon 403/circuit-open errors.
//
// Fix: wrap each leg of the Promise.all in its own `.catch()` that degrades to the same sentinel
// the rest of the function already treats as "no data" (`[]` for bars — triggering the existing
// `if (!bars.length) return empty;` branch — `null` for RSI, mirroring fetchIndexRsi's own
// internal guard). This test mocks the fetchers directly (not polygonTrackedFetch) because the
// isolation under test lives in spx-play-technicals.ts itself, not in polygon.ts.
import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { PlayTechnicals } from "./spx-play-technicals";

// polygonConfigured() (src/lib/providers/config.ts) reads POLYGON_API_KEY live and is NOT mocked
// here (it's a trivial, import-free env read) — buildPlayTechnicals' very first line is
// `if (!polygonConfigured() || price <= 0) return empty;`, so without this the fetch mocks below
// would never even be reached.
process.env.POLYGON_API_KEY = "test-polygon-key-throw-isolation";

type BarsOutcome = { kind: "ok"; bars: Array<{ t: number; o: number; h: number; l: number; c: number; v?: number }> } | { kind: "throw" };
type RsiOutcome = { kind: "ok"; value: number | null } | { kind: "throw" };

let barsOutcome: BarsOutcome = { kind: "ok", bars: [] };
let rsiOutcome: RsiOutcome = { kind: "ok", value: null };
let barsCalls = 0;
let rsiCalls = 0;

// Relative specifier, not the "@/..." alias — tsx's alias rewrite only applies to statically-
// parsed top-level `import ... from` statements, not to mock.module()'s specifier string.
mock.module("../../../lib/providers/polygon", {
  namedExports: {
    fetchIndexMinuteBars: async (_sym: string, _from: string, _to: string) => {
      barsCalls++;
      if (barsOutcome.kind === "throw") {
        throw new Error("Polygon /v2/aggs/ticker/I:SPX/range/1/minute/... → 403");
      }
      return barsOutcome.bars;
    },
    fetchIndexRsi: async (_sym: string, _window: number, _timespan: string) => {
      rsiCalls++;
      if (rsiOutcome.kind === "throw") {
        // fetchIndexRsi's REAL implementation never actually throws (it already guards itself
        // internally) — this exercises the double-fault case defensively, in case that internal
        // guard is ever removed or a sibling caller bypasses it.
        throw new Error("Polygon /v1/indicators/rsi/I:SPX → 403");
      }
      return rsiOutcome.value;
    },
  },
});

let buildPlayTechnicals: typeof import("./spx-play-technicals").buildPlayTechnicals;

before(async () => {
  ({ buildPlayTechnicals } = await import("./spx-play-technicals"));
});

beforeEach(() => {
  barsOutcome = { kind: "ok", bars: [] };
  rsiOutcome = { kind: "ok", value: null };
  barsCalls = 0;
  rsiCalls = 0;
});

const CTX = { vwap: 5500, pdh: 5520, pdl: 5480, hod: 5515, lod: 5490 };

/**
 * The exact "empty" shape the function already returns via its early `price <= 0` branch —
 * reused as the known-good baseline instead of duplicating the large literal, so this test can't
 * silently drift from the real shape. Only `price` differs between the baseline call and the
 * fetch-under-test call.
 */
async function emptyShapeBaseline(): Promise<PlayTechnicals> {
  return buildPlayTechnicals(0, CTX);
}

test("a genuine fetchIndexMinuteBars THROW degrades to the same available:false shape as empty bars, instead of propagating (2026-11-09 fix)", async () => {
  barsOutcome = { kind: "throw" };
  rsiOutcome = { kind: "ok", value: 55 };

  // Pre-fix (RED): this call rejects — the raw Polygon error propagates straight out of
  // buildPlayTechnicals instead of degrading. Post-fix (GREEN): it resolves to the empty shape.
  const result = await buildPlayTechnicals(5500, CTX);
  const baseline = await emptyShapeBaseline();

  assert.equal(result.available, false, "must degrade to available:false, not propagate the throw");
  assert.deepEqual(
    { ...result, price: 0 },
    baseline,
    "a thrown bars fetch must produce the EXACT same shape as the genuinely-empty-bars path (only price differs)"
  );
  assert.equal(barsCalls, 1);
});

test("fetchIndexRsi ALSO throwing (double-fault) is still graceful — no unhandled rejection, same empty shape", async () => {
  barsOutcome = { kind: "throw" };
  rsiOutcome = { kind: "throw" };

  const result = await buildPlayTechnicals(5505, CTX);
  const baseline = await emptyShapeBaseline();

  assert.equal(result.available, false);
  assert.deepEqual({ ...result, price: 0 }, baseline, "a double-fault must still degrade to the exact empty shape");
});

test("a genuinely-empty bars response (fetch resolves to []) still returns the same available:false shape — unchanged pre-existing behavior", async () => {
  barsOutcome = { kind: "ok", bars: [] };
  rsiOutcome = { kind: "ok", value: 60 };

  const result = await buildPlayTechnicals(5510, CTX);
  const baseline = await emptyShapeBaseline();

  assert.equal(result.available, false);
  assert.deepEqual({ ...result, price: 0 }, baseline);
  assert.equal(barsCalls, 1, "bars fetch must still be called exactly once on the genuinely-empty path");
});

test("a successful bars fetch with real data still produces an available:true result (no over-broad catch)", async () => {
  const t0 = Date.UTC(2026, 10, 9, 14, 30, 0); // 09:30 ET
  barsOutcome = {
    kind: "ok",
    bars: Array.from({ length: 20 }, (_, i) => ({
      t: t0 + i * 60_000,
      o: 5500 + i,
      h: 5502 + i,
      l: 5498 + i,
      c: 5501 + i,
      v: 100,
    })),
  };
  rsiOutcome = { kind: "ok", value: 58 };

  const result = await buildPlayTechnicals(5520, CTX);
  assert.equal(result.available, true, "a genuine success must not be swallowed by the new error isolation");
  assert.equal(result.m1_bars, 20);
});
