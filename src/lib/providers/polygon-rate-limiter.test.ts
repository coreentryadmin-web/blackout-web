import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression for the vector-universe-snapshot unbounded fan-out (measured live 2026-09-04:
// firing all ~85-100 universe tickers' fetchGexHeatmap calls via Promise.allSettled at once left
// several genuinely-available, liquid tickers — DIA/AAOI/DRAM/ZS/NOK — served as fully-null rows
// by GET /api/market/vector/universe, though a solo GET /api/market/gex-heatmap?ticker=<T> for
// each returned available:true seconds later). Same shape as the already-fixed
// vector-dark-pool-warm incident (FINDINGS.md 2026-09-02) on the UW side. runPolygonPool is the
// fix callers reach for; this proves the primitive itself actually bounds concurrency rather
// than just documenting an intent in its docstring — mirrors uw-rate-limiter.test.ts's runUwPool
// coverage exactly.
test("runPolygonPool never runs more than `concurrency` tasks at once", async () => {
  const { runPolygonPool } = await import("./polygon-rate-limiter");
  let inFlight = 0;
  let maxInFlight = 0;
  const tasks = Array.from({ length: 20 }, (_, i) => async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    return i;
  });

  const results = await runPolygonPool(tasks, 3);

  assert.deepEqual(results, tasks.map((_, i) => i), "results preserve input order despite pooled execution");
  assert.ok(maxInFlight <= 3, `expected at most 3 concurrent tasks, saw ${maxInFlight}`);
  assert.ok(maxInFlight > 1, "sanity: the pool should actually overlap work, not degrade to fully sequential");
});

test("runPolygonPool tolerates an unbounded task count without ever exceeding its concurrency cap", async () => {
  const { runPolygonPool } = await import("./polygon-rate-limiter");
  let inFlight = 0;
  let maxInFlight = 0;
  const tasks = Array.from({ length: 100 }, () => async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return null;
  });

  await runPolygonPool(tasks, 8);

  assert.ok(maxInFlight <= 8, `100-task fan-out must still respect the concurrency cap, saw ${maxInFlight}`);
});

test("runPolygonPool defaults to a concurrency well below the raw admission ceiling (source scan)", () => {
  // Not a numeric behavioral assertion (the default is env-overridable and this must not pin the
  // env-tunable number) — proves the DEFAULT parameter exists and is distinct from MAX_CONCURRENCY,
  // so a future edit can't quietly wire runPolygonPool's default straight to the raw admission cap
  // (48), which would leave live desk/GEX/pulse traffic with too few free slots during a full
  // universe sweep — the same "reserve live-traffic headroom" property runUwPool already has.
  const src = readFileSync(new URL("./polygon-rate-limiter.ts", import.meta.url), "utf8");
  assert.match(src, /POOL_MAX_CONCURRENCY/);
  assert.match(
    src,
    /export async function runPolygonPool[\s\S]*?concurrency = POOL_MAX_CONCURRENCY/,
    "runPolygonPool must default to its own smaller pool concurrency, not MAX_CONCURRENCY directly"
  );
});
