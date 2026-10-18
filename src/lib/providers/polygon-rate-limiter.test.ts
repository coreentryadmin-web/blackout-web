import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// Regression for the alerting gap found live 2026-09-16: a P0 (`zerodte-warm` reported stale
// during RTH by cron-staleness-watchdog) traced to `[polygon-gex]` chain fetches failing at the
// `global_rps` admission stage across 450+ distinct tickers within a single hour — a real,
// sustained surge on this limiter's own 150 RPS self-cap, with no alert anywhere to page ops
// about it (only uw-rate-limiter.ts had one, added 2026-09-15/16). Ported the same pattern here.
test("pruneQueueTimeoutWindow drops timestamps outside the window, keeps the ones inside it", async () => {
  const { pruneQueueTimeoutWindow } = await import("./polygon-rate-limiter");
  const now = 100_000;
  const kept = pruneQueueTimeoutWindow([now - 70_000, now - 61_000, now - 59_999, now - 1_000, now], now, 60_000);
  assert.deepEqual(kept, [now - 59_999, now - 1_000, now]);
});

test("pruneQueueTimeoutWindow: an empty or fully-stale window prunes to empty, never throws", async () => {
  const { pruneQueueTimeoutWindow } = await import("./polygon-rate-limiter");
  assert.deepEqual(pruneQueueTimeoutWindow([], 100_000, 60_000), []);
  assert.deepEqual(pruneQueueTimeoutWindow([1_000, 2_000], 100_000, 60_000), []);
});

test("queue-timeout surge alert fires only at the sustained threshold, not on a single timeout — and re-arms once the rolling count recovers", async () => {
  const {
    noteQueueTimeoutForAlert,
    noteQueueAdmissionRecoveryForAlert,
    isQueueTimeoutAlertLatched,
    resetQueueTimeoutAlertForTest,
  } = await import("./polygon-rate-limiter");
  resetQueueTimeoutAlertForTest();

  let t = 0;
  const now = () => t;

  for (let i = 0; i < 4; i++) {
    noteQueueTimeoutForAlert(now);
    t += 1_000;
  }
  assert.equal(isQueueTimeoutAlertLatched(), false, "must not page below the sustained threshold");

  noteQueueTimeoutForAlert(now);
  assert.equal(isQueueTimeoutAlertLatched(), true, "must page once the sustained threshold is crossed");

  noteQueueTimeoutForAlert(now);
  assert.equal(isQueueTimeoutAlertLatched(), true);

  t += 120_000;
  noteQueueAdmissionRecoveryForAlert(now);
  assert.equal(isQueueTimeoutAlertLatched(), false, "must re-arm once the rolling count drops back under threshold");
});

test("noteQueueAdmissionRecoveryForAlert is a no-op while not latched (the common healthy-admission path)", async () => {
  const { noteQueueAdmissionRecoveryForAlert, isQueueTimeoutAlertLatched, resetQueueTimeoutAlertForTest } =
    await import("./polygon-rate-limiter");
  resetQueueTimeoutAlertForTest();
  assert.doesNotThrow(() => noteQueueAdmissionRecoveryForAlert());
  assert.equal(isQueueTimeoutAlertLatched(), false);
});

test("polygonTrackedFetch records a queue timeout via isQueueTimeout before re-throwing, and calls the recovery hook on success", () => {
  const src = readFileSync(fileURLToPath(new URL("./polygon-rate-limiter.ts", import.meta.url)), "utf8");
  const fn = src.match(/export async function polygonTrackedFetch[\s\S]*?\n}/)?.[0];
  assert.ok(fn, "polygonTrackedFetch() not found");
  assert.match(fn!, /catch \(err\) \{\s*if \(isQueueTimeout\(err\)\) noteQueueTimeoutForAlert\(\);\s*throw err;/);
  assert.match(fn!, /noteQueueAdmissionRecoveryForAlert\(\);/);
});

// Regression for the 2026-10-15 live incident (FINDINGS.md "Live ALB tail-latency incident" /
// #4076 comments 6197984130, 6199692739): vector-bead-recorder-leader.ts's continuous 5s/15s
// universe-wide GEX polling structurally saturated this shared limiter's global_rps AND local_slot
// admission stages at once, starving OTHER desks' (0DTE/SPX/Thermal) Polygon chain fetches of the
// same shared budget — two confirmed live-RTH 0DTE discovery/governor outages were time-correlated
// with it. reserveForLiveTraffic is the fix: a caller tagged via runWithBackgroundPolygonSweep sees
// a REDUCED ceiling at admission; every other (untagged) caller — which is every existing caller
// today — sees the ceiling completely unchanged, so this is purely additive until a call site
// opts in.
test("reserveForLiveTraffic returns the ceiling UNCHANGED outside runWithBackgroundPolygonSweep (default-safe: every existing caller is unaffected)", async () => {
  const { reserveForLiveTraffic } = await import("./polygon-rate-limiter");
  assert.equal(reserveForLiveTraffic(150), 150);
  assert.equal(reserveForLiveTraffic(48), 48);
  assert.equal(reserveForLiveTraffic(1), 1);
});

test("reserveForLiveTraffic reduces the ceiling for a tagged background sweep, by a real (non-trivial) share, never to zero", async () => {
  const { reserveForLiveTraffic, runWithBackgroundPolygonSweep } = await import("./polygon-rate-limiter");
  const [rps, concurrency, tiny] = await runWithBackgroundPolygonSweep(async () =>
    [reserveForLiveTraffic(150), reserveForLiveTraffic(48), reserveForLiveTraffic(1)] as const
  );
  assert.ok(rps < 150 && rps > 0, `expected a real reduction below 150, got ${rps}`);
  assert.ok(concurrency < 48 && concurrency > 0, `expected a real reduction below 48, got ${concurrency}`);
  // Default share is 0.5 — proves this isn't UW's flat "-1" (which would be a near-no-op at these
  // ceilings): half of 150 is a real double-digit reservation, not 149.
  assert.ok(rps <= 90, `default share must reserve a meaningful (not token) fraction of 150, got ${rps}`);
  assert.equal(tiny, 1, "a ceiling of 1 must never be reserved down to 0 — the sweep can always make SOME progress");
});

test("reserveForLiveTraffic tagging is isolated per async context — a concurrent untagged caller is never affected by a sweep running elsewhere", async () => {
  const { reserveForLiveTraffic, runWithBackgroundPolygonSweep } = await import("./polygon-rate-limiter");
  const [sweepSeen, liveSeen] = await Promise.all([
    runWithBackgroundPolygonSweep(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return reserveForLiveTraffic(150);
    }),
    (async () => {
      await new Promise((r) => setTimeout(r, 1));
      return reserveForLiveTraffic(150);
    })(),
  ]);
  assert.ok(sweepSeen < 150, "the tagged call must see a reduced ceiling");
  assert.equal(liveSeen, 150, "a concurrent call OUTSIDE the tagged context must see the full ceiling, unaffected by the sweep running at the same time");
});

test("acquireGlobalRedisSlot passes the RESERVED ceiling to the RPS sliding window, not the raw GLOBAL_MAX_RPS (source scan — Redis is not mockable here, mirrors uw-rate-limiter.test.ts's identical convention)", () => {
  const src = readFileSync(fileURLToPath(new URL("./polygon-rate-limiter.ts", import.meta.url)), "utf8");
  const callLine = src.split("\n").find((line) => line.includes('"blackout:polygon:rps"'));
  assert.ok(callLine, "expected to find the blackout:polygon:rps acquireSlidingWindowRedisSlot call site");
  assert.ok(
    callLine!.includes("reserveForLiveTraffic(GLOBAL_MAX_RPS)"),
    `the RPS ceiling must be reservation-aware — got: ${callLine}`
  );
  assert.ok(
    !callLine!.includes(", GLOBAL_MAX_RPS)"),
    "the raw unreserved GLOBAL_MAX_RPS must not be passed directly any more"
  );
});

test("acquireLocalSlot's concurrency admission uses effectiveMaxConcurrency(), not the raw MAX_CONCURRENCY, on both the admit check and the delay branch", () => {
  const src = readFileSync(fileURLToPath(new URL("./polygon-rate-limiter.ts", import.meta.url)), "utf8");
  const fn = src.match(/async function acquireLocalSlot[\s\S]*?\n}/)?.[0];
  assert.ok(fn, "acquireLocalSlot() not found");
  assert.match(fn!, /const concurrencyCap = effectiveMaxConcurrency\(\);/);
  assert.match(fn!, /if \(inFlight < concurrencyCap && tokens >= 1\)/);
  assert.match(fn!, /const delay = inFlight >= concurrencyCap \? 50 : waitMsForToken\(\);/);
  assert.doesNotMatch(fn!, /MAX_CONCURRENCY/, "no raw MAX_CONCURRENCY reference should remain in the admission loop itself");
});

test("effectiveMaxConcurrency() composes MAX_CONCURRENCY through reserveForLiveTraffic, mirroring the RPS side", () => {
  const src = readFileSync(fileURLToPath(new URL("./polygon-rate-limiter.ts", import.meta.url)), "utf8");
  assert.match(
    src,
    /function effectiveMaxConcurrency\(\): number \{\s*return reserveForLiveTraffic\(MAX_CONCURRENCY\);\s*\}/
  );
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
