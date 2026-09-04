import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  recordStockTick,
  getStockLiveCandle,
  getStockCandleStoreStats,
  wsSpotPrice,
  computeChangePct,
  _resetStockCandleStoreForTest,
  _setSnapshotFetcherForTest,
  _setStockCandleUpdatedAtForTest,
} from "./stock-candle-store";
import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "./timestamp-freshness";

// Every test in this file must stay network-free: stub the REST session-open
// seed to resolve to "no anchor" immediately (same effect as offline/no key),
// so getStockLiveCandle()'s lazy seed never reaches the real Polygon provider.
_setSnapshotFetcherForTest(async () => null);

test("recordStockTick: first tick opens a bar with open=high=low=close", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:30:05.000Z");
  recordStockTick("SPY", 605.5, undefined, atMs);

  const { current } = getStockLiveCandle("SPY");
  assert.ok(current);
  assert.equal(current!.open, 605.5);
  assert.equal(current!.high, 605.5);
  assert.equal(current!.low, 605.5);
  assert.equal(current!.close, 605.5);
  assert.equal(current!.time, Math.floor(atMs / 60_000) * 60);
});

test("recordStockTick: updates high/low/close within same minute", () => {
  _resetStockCandleStoreForTest();
  const base = Date.parse("2026-07-15T14:31:00.000Z");

  recordStockTick("NVDA", 140, undefined, base);
  recordStockTick("NVDA", 142, undefined, base + 10_000);
  recordStockTick("NVDA", 138, undefined, base + 20_000);
  recordStockTick("NVDA", 141, undefined, base + 30_000);

  const { current } = getStockLiveCandle("NVDA");
  assert.equal(current!.open, 140);
  assert.equal(current!.high, 142);
  assert.equal(current!.low, 138);
  assert.equal(current!.close, 141);
});

test("recordStockTick: next minute opens a new bar", () => {
  _resetStockCandleStoreForTest();
  const m1 = Date.parse("2026-07-15T14:32:00.000Z");
  const m2 = Date.parse("2026-07-15T14:33:05.000Z");

  recordStockTick("AAPL", 230, undefined, m1);
  recordStockTick("AAPL", 232, undefined, m1 + 30_000);
  recordStockTick("AAPL", 235, undefined, m2);

  const { current } = getStockLiveCandle("AAPL");
  assert.equal(current!.open, 235);
  assert.equal(current!.time, Math.floor(m2 / 60_000) * 60);
});

test("recordStockTick: ignores non-finite and non-positive prices", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:34:00.000Z");
  recordStockTick("META", 520, undefined, atMs);
  const before = getStockLiveCandle("META").current;

  recordStockTick("META", NaN, undefined, atMs + 1000);
  recordStockTick("META", 0, undefined, atMs + 2000);
  recordStockTick("META", -5, undefined, atMs + 3000);

  assert.deepEqual(getStockLiveCandle("META").current, before);
});

test("recordStockTick: late tick from prior minute is dropped", () => {
  _resetStockCandleStoreForTest();
  const m0 = Date.parse("2026-07-15T14:35:00.000Z");
  const m1 = Date.parse("2026-07-15T14:36:00.000Z");

  recordStockTick("TSLA", 280, undefined, m0 + 1_000);
  recordStockTick("TSLA", 285, undefined, m1 + 1_000);
  recordStockTick("TSLA", 283, undefined, m1 + 2_000);
  recordStockTick("TSLA", 275, undefined, m0 + 59_000); // late tick from m0

  const snap = getStockLiveCandle("TSLA");
  assert.equal(snap.current?.time, Math.floor(m1 / 60_000) * 60);
  assert.equal(snap.current?.open, 285);
  assert.equal(snap.current?.low, 283);
});

test("recordStockTick: normalizes ticker to uppercase", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:37:00.000Z");

  recordStockTick("spy", 605, undefined, atMs);
  const snap = getStockLiveCandle("SPY");
  assert.ok(snap.current);
  assert.equal(snap.current!.close, 605);
});

test("recordStockTick: tracks volume when provided", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:38:00.000Z");

  recordStockTick("AMD", 180, 50000, atMs);
  const snap = getStockLiveCandle("AMD");
  assert.equal(snap.current!.volume, 50000);
});

test("getStockLiveCandle: returns null for unknown ticker", () => {
  _resetStockCandleStoreForTest();
  const snap = getStockLiveCandle("ZZZZ");
  assert.equal(snap.current, null);
  assert.equal(snap.updatedAt, 0);
  assert.equal(snap.changePct, null);
});

test("computeChangePct: rounds to 2dp and matches the indexStore sibling's rounding", () => {
  assert.equal(computeChangePct(605.5, 600), 0.92);
  assert.equal(computeChangePct(595, 600), -0.83);
});

test("computeChangePct: returns 0 when there is no session-open anchor yet", () => {
  assert.equal(computeChangePct(605.5, 0), 0);
});

test("recordStockTick: first bar of the day seeds a provisional ws-bar session_open when REST hasn't resolved", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:45:00.000Z");
  recordStockTick("PLTR", 40, undefined, atMs);
  recordStockTick("PLTR", 41, undefined, atMs + 5_000);

  // No REST anchor (stubbed to null) — change% is computed off the first bar's
  // open (40), same fallback tier indexStore uses on a mid-session reconnect.
  const snap = getStockLiveCandle("PLTR");
  assert.equal(snap.current?.close, 41);
  assert.equal(snap.changePct, computeChangePct(41, 40));
});

test("getStockLiveCandle: a REST-seeded session_open anchor overrides the ws-bar open", async () => {
  _resetStockCandleStoreForTest();
  _setSnapshotFetcherForTest(async () => ({ prev_close: 100 }) as Awaited<ReturnType<typeof import("../providers/polygon").fetchStockSnapshot>>);
  const atMs = Date.parse("2026-07-15T14:46:00.000Z");
  recordStockTick("ORCL", 105, undefined, atMs);

  // First read fires the REST seed (async) — the ws-bar open (105, its own
  // first tick) briefly anchors changePct=0 until the stub resolves.
  getStockLiveCandle("ORCL");
  // Flush past a macrotask boundary (not just one microtask hop) so the
  // stubbed fetch's .then() chain inside seedSessionOpenIfNeeded is guaranteed
  // to have run before we re-read, regardless of exact microtask interleaving.
  await new Promise((resolve) => setImmediate(resolve));

  const snap = getStockLiveCandle("ORCL");
  assert.equal(snap.changePct, computeChangePct(105, 100));
  _setSnapshotFetcherForTest(async () => null);
});

test("getStockLiveCandle: a seed attempt that comes back empty does NOT retry on every subsequent call", async () => {
  // Regression: the first cut of this fix re-fired fetchStockSnapshot on EVERY
  // getStockLiveCandle() call whenever the seed attempt didn't land a "rest"
  // anchor (bad/delisted ticker, transient failure) — an unbounded per-request
  // retry storm against the upstream, caught by quote/route.test.ts's mocked
  // call-count assertions going from "called once" to "called on every poll."
  _resetStockCandleStoreForTest();
  let calls = 0;
  _setSnapshotFetcherForTest(async () => {
    calls++;
    return null;
  });
  const atMs = Date.parse("2026-07-15T14:48:00.000Z");
  recordStockTick("ZZZZ", 10, undefined, atMs);

  getStockLiveCandle("ZZZZ");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  // Several more reads in quick succession (well within the cooldown window)
  // must NOT re-trigger the fetch.
  getStockLiveCandle("ZZZZ");
  getStockLiveCandle("ZZZZ");
  getStockLiveCandle("ZZZZ");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  _setSnapshotFetcherForTest(async () => null);
});

test("seedSessionOpenIfNeeded: a REST seed that resolves AFTER a day rollover must not stamp the new session with the stale prior-day anchor", async (t) => {
  // Regression for the day-rollover race: recordStockTick's day-rollover branch
  // resets openSource back to "" (not "rest") on a new ET session day, so the
  // .then() callback's ORIGINAL guard (`s.openSource === "rest"`) could not detect
  // a REST fetch that outlived the session it was fired for — it only caught a
  // concurrent seed that had ALREADY landed for the SAME session. A fetch fired
  // just before ET midnight and resolving just after would sail past that guard
  // and permanently stamp the new session with an anchor fetched for the old one
  // ("rest" is never downgraded back to "ws-bar").
  //
  // `recordStockTick`'s day-rollover check compares `todayEtYmd()` — the REAL ET
  // wall-clock date, with no injection point in this store — against the ticker's
  // stored sessionDate, so a genuine same-process day rollover can only be produced
  // by faking Date itself (varying only the `atMs` bar-timestamp argument does not
  // change what day the store believes it is).
  _resetStockCandleStoreForTest();

  const dayOne = Date.parse("2026-07-15T23:00:00.000Z"); // 19:00 ET, 2026-07-15 (EDT, UTC-4)
  t.mock.timers.enable({ apis: ["Date"], now: dayOne });

  recordStockTick("RGLD", 50, undefined, Date.now());
  // No REST anchor has landed yet -> ws-bar fallback seeds day 1's sessionOpen=50.

  // Fire the REST seed for DAY 1's session but keep its promise pending, simulating
  // a demanded read whose fetch was in flight right as the session rolled over.
  let resolveSeed!: (v: { prev_close: number } | null) => void;
  const pendingSeed = new Promise<{ prev_close: number } | null>((resolve) => {
    resolveSeed = resolve;
  });
  _setSnapshotFetcherForTest(
    () => pendingSeed as ReturnType<typeof import("../providers/polygon").fetchStockSnapshot>
  );
  getStockLiveCandle("RGLD"); // fires seedSessionOpenIfNeeded, captured for day 1

  // Cross the ET midnight boundary (00:00 ET = 04:00 UTC on 2026-07-16) while that
  // day-1 fetch is still unresolved.
  t.mock.timers.tick(6 * 60 * 60 * 1000); // +6h -> 01:00 ET, 2026-07-16 (day 2)
  recordStockTick("RGLD", 70, undefined, Date.now());
  // recordStockTick's rollover branch has now reset sessionDate/sessionOpen/openSource
  // for day 2 and re-seeded a fresh ws-bar anchor at 70 — all while the day-1 fetch
  // above is still in flight.

  // The day-1 fetch NOW resolves with day-1's own prev_close — correct for day 1,
  // stale for day 2. Pre-fix this landed anyway because openSource was reset to ""
  // (not "rest") by the rollover, so the old guard never caught it.
  resolveSeed({ prev_close: 999 });
  await new Promise((resolve) => setImmediate(resolve));

  const snap = getStockLiveCandle("RGLD");
  // Day 2's own ws-bar anchor (70) must still be authoritative; the stale day-1
  // REST value (999) must never have been applied to the new session.
  assert.equal(snap.changePct, computeChangePct(70, 70));
  assert.notEqual(snap.changePct, computeChangePct(70, 999));

  _setSnapshotFetcherForTest(async () => null);
});

test("separate tickers have independent state", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:40:00.000Z");

  recordStockTick("SPY", 605, undefined, atMs);
  recordStockTick("QQQ", 525, undefined, atMs);

  assert.equal(getStockLiveCandle("SPY").current!.close, 605);
  assert.equal(getStockLiveCandle("QQQ").current!.close, 525);
});

test("getStockLiveCandle marks ticker as demanded for on-demand Redis writes", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:41:00.000Z");

  recordStockTick("TSLA", 280, undefined, atMs);
  recordStockTick("AAPL", 230, undefined, atMs);

  const stats1 = getStockCandleStoreStats();
  assert.equal(stats1.total, 2);
  assert.equal(stats1.demanded, 0);

  getStockLiveCandle("TSLA");

  const stats2 = getStockCandleStoreStats();
  assert.equal(stats2.total, 2);
  assert.equal(stats2.demanded, 1);

  getStockLiveCandle("AAPL");
  const stats3 = getStockCandleStoreStats();
  assert.equal(stats3.demanded, 2);
});

test("getStockCandleStoreStats: tracks total tickers in memory", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:42:00.000Z");

  assert.equal(getStockCandleStoreStats().total, 0);

  for (let i = 0; i < 100; i++) {
    recordStockTick(`T${i}`, 100 + i, undefined, atMs);
  }
  assert.equal(getStockCandleStoreStats().total, 100);
  assert.equal(getStockCandleStoreStats().demanded, 0);
});

test("wsSpotPrice: returns price for fresh ticker", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:43:00.000Z");
  recordStockTick("MSFT", 460, undefined, atMs);
  const price = wsSpotPrice("MSFT");
  assert.equal(price, 460);
  assert.equal(getStockCandleStoreStats().demanded, 1);
});

test("wsSpotPrice: returns null for unknown ticker", () => {
  _resetStockCandleStoreForTest();
  assert.equal(wsSpotPrice("UNKNOWN"), null);
});

test("wsSpotPrice: normalizes to uppercase", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:44:00.000Z");
  recordStockTick("GOOG", 195, undefined, atMs);
  assert.equal(wsSpotPrice("goog"), 195);
});

test("getStockLiveCandle: future updatedAt does not read as fresh (clock-skew guard)", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:50:00.000Z");
  recordStockTick("COIN", 300, undefined, atMs);
  _setStockCandleUpdatedAtForTest("COIN", atMs + WS_TIMESTAMP_FUTURE_TOLERANCE_MS + 1_000);

  const snap = getStockLiveCandle("COIN");
  assert.equal(snap.current, null);
  assert.equal(snap.changePct, null);
});

test("getStockLiveCandle: source uses isWsUpdatedAtFresh for local freshness, not raw Date.now() - updatedAt", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "stock-candle-store.ts"), "utf8");
  assert.match(src, /isWsUpdatedAtFresh\(local\.updatedAt, LOCAL_STALE_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\) - local\.updatedAt <= LOCAL_STALE_MS/);
});
