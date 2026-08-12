import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trackTickerFailures,
  evaluateSweepBudget,
  withDeadline,
  makeInFlightGuard,
} from "./vector-bead-recorder-logic";

// ─────────────────────────────────────────────────────────────────────────────
// P1 2026-08-07: ASTS lost ~10 min of rail inside RTH and left ZERO log trace.
// ─────────────────────────────────────────────────────────────────────────────

const UNIVERSE = ["SPX", "SPY", "QQQ", "NVDA", "ASTS", "AMD"];

test("REGRESSION: one ticker going dark is DETECTED — the whole-pass warning never fired for it", () => {
  // The old leader only warned when recorded === 0. ASTS failing while 121 others succeeded gave
  // recorded=121, failed=1 and logged nothing at all.
  const state = new Map<string, number>();
  // Two failed passes: below threshold, still silent (a single flaky fetch must not page).
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), []);
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), []);
  // Third consecutive failure crosses TICKER_DARK_THRESHOLD → named, once.
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), [
    { ticker: "ASTS", kind: "dark", consecutive: 3 },
  ]);
});

test("a 10-minute outage costs TWO log lines, not one per 5s tick", () => {
  // 10 min at the 5s universe cadence = 120 passes. Logging each would bury the incident in the
  // logs it is supposed to illuminate.
  const state = new Map<string, number>();
  let events = 0;
  for (let pass = 0; pass < 120; pass++) events += trackTickerFailures(state, UNIVERSE, ["ASTS"]).length;
  assert.equal(events, 1, "exactly one DARK edge across 120 failing passes");
  const recovered = trackTickerFailures(state, UNIVERSE, []);
  assert.deepEqual(recovered, [{ ticker: "ASTS", kind: "recovered", consecutive: 120 }]);
  assert.equal(events + recovered.length, 2, "one outage → two lines total");
});

test("recovery reports the REAL streak length, so the log shows how long it was dark", () => {
  const state = new Map<string, number>();
  for (let i = 0; i < 7; i++) trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  const [ev] = trackTickerFailures(state, UNIVERSE, []);
  assert.equal(ev?.consecutive, 7, "~35s dark must be recoverable from the log alone");
});

test("a blip BELOW the threshold never announces dark OR recovered", () => {
  // Otherwise every transient upstream hiccup across ~122 tickers becomes noise.
  const state = new Map<string, number>();
  trackTickerFailures(state, UNIVERSE, ["NVDA"]);
  trackTickerFailures(state, UNIVERSE, ["NVDA"]);
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, []), [], "no recovery for a never-announced ticker");
  assert.equal(state.size, 0, "and the streak is cleared");
});

test("streaks must be CONSECUTIVE — an intervening success resets the counter", () => {
  const state = new Map<string, number>();
  trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  trackTickerFailures(state, UNIVERSE, []);          // recovered before crossing
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), [], "counter restarted at 1");
  trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), [
    { ticker: "ASTS", kind: "dark", consecutive: 3 },
  ]);
});

test("state stays bounded by CURRENTLY-failing tickers, not universe size", () => {
  // This map lives for the process lifetime on a 5s loop — an unbounded one is a slow leak.
  const state = new Map<string, number>();
  for (let i = 0; i < 50; i++) trackTickerFailures(state, UNIVERSE, ["ASTS", "AMD"]);
  assert.equal(state.size, 2);
  trackTickerFailures(state, UNIVERSE, []);
  assert.equal(state.size, 0, "all successes are evicted");
});

test("a ticker NOT attempted this pass keeps its streak — absence is not recovery", () => {
  // The universe is dynamic; a name dropping out of the roster must not be logged as "recovered".
  const state = new Map<string, number>();
  for (let i = 0; i < 4; i++) trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  const events = trackTickerFailures(state, ["SPX", "SPY"], []); // ASTS not in this roster
  assert.deepEqual(events, []);
  assert.equal(state.get("ASTS"), 4, "streak preserved");
});

// ── Sweep budget alarm ────────────────────────────────────────────────────────────────────────

test("evaluateSweepBudget: a sweep inside budget says nothing", () => {
  const st = { lastLoggedAt: 0 };
  assert.equal(evaluateSweepBudget(3_000, 5_000, 122, 122, 1_000_000, st).kind, "ok");
  // Modest overrun is tolerated — the alarm is for a sweep that is structurally too slow, not one
  // that occasionally drifts a few hundred ms past the tick.
  assert.equal(evaluateSweepBudget(7_000, 5_000, 122, 122, 1_000_000, st).kind, "ok");
  assert.equal(st.lastLoggedAt, 0, "nothing logged means the rate limiter was not consumed");
});

test("evaluateSweepBudget: reports the ACHIEVED cadence, rounded up to whole dropped ticks", () => {
  const st = { lastLoggedAt: 0 };
  const v = evaluateSweepBudget(31_000, 5_000, 120, 122, 1_000_000, st);
  assert.equal(v.kind, "overrun");
  if (v.kind !== "overrun") return;
  // 31s of work on a 5s tick: ticks 2..7 all land inside the running sweep and are dropped, so the
  // next sample lands at 35s — NOT 31s. Reporting raw elapsed would understate the real gap a
  // member sees on the rail, which is the number this alarm exists to match.
  assert.equal(v.effectiveCadenceMs, 35_000);
  assert.equal(v.recorded, 120);
  assert.equal(v.total, 122);
});

test("evaluateSweepBudget: the real 2026-08-07 and 2026-08-12 regressions both trip it", () => {
  // 10s achieved (2026-08-07, found by a member) and ~30s achieved (2026-08-12, found by a member).
  // Neither produced a single log line at the time. Both must now be loud.
  for (const elapsed of [9_000, 29_000]) {
    const st = { lastLoggedAt: 0 };
    assert.equal(
      evaluateSweepBudget(elapsed, 5_000, 122, 122, 1_000_000, st).kind,
      "overrun",
      `${elapsed}ms sweep on a 5s budget must be reported`
    );
  }
});

test("evaluateSweepBudget: a chronically slow sweep is ONE fact, not one per tick", () => {
  const st = { lastLoggedAt: 0 };
  const now = 1_000_000;
  assert.equal(evaluateSweepBudget(31_000, 5_000, 122, 122, now, st).kind, "overrun");
  // Every subsequent tick is equally over budget; logging each would bury the signal it raises.
  assert.equal(evaluateSweepBudget(31_000, 5_000, 122, 122, now + 5_000, st).kind, "ok");
  assert.equal(evaluateSweepBudget(31_000, 5_000, 122, 122, now + 59_000, st).kind, "ok");
  // ...but it must not go quiet forever: the condition is still true a minute later.
  assert.equal(evaluateSweepBudget(31_000, 5_000, 122, 122, now + 61_000, st).kind, "overrun");
});

test("evaluateSweepBudget: junk inputs never fabricate an alarm", () => {
  const st = { lastLoggedAt: 0 };
  assert.equal(evaluateSweepBudget(NaN, 5_000, 1, 1, 1, st).kind, "ok");
  assert.equal(evaluateSweepBudget(31_000, 0, 1, 1, 1, st).kind, "ok");
  assert.equal(evaluateSweepBudget(31_000, NaN, 1, 1, 1, st).kind, "ok");
});

// ── Per-ticker deadline + in-flight guard ─────────────────────────────────────────────────────

const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

test("withDeadline: a straggler cannot hold the sweep past its budget", () => {
  // The sweep's duration is a MAX, not a sum — concurrency (64) exceeds a shard (~25), so every
  // ticker starts at once and ONE slow name sets the cadence for the whole shard. Measured on prod
  // after sharding: 23-25 ticker slices still took 10-30s.
  return (async () => {
    const t0 = Date.now();
    const got = await withDeadline(later(5_000, true), 50, () => false);
    assert.equal(got, false, "timeout yields the fallback, not the slow value");
    assert.ok(Date.now() - t0 < 1_000, "must not wait for the straggler");
  })();
});

test("withDeadline: work that finishes in time is untouched", async () => {
  assert.equal(await withDeadline(later(5, "ok"), 500, () => "late"), "ok");
});

test("withDeadline: a rejection still rejects — a deadline is not an error swallower", async () => {
  await assert.rejects(
    withDeadline(Promise.reject(new Error("boom")), 500, () => "fallback"),
    /boom/
  );
});

test("withDeadline: a late resolution cannot overwrite the timeout result", async () => {
  // The abandoned work keeps running by design (nothing to abort). If its late resolve could still
  // settle the promise, the caller would observe a value AFTER it had already moved on.
  let settledTwice = 0;
  const p = withDeadline(later(80, "late"), 20, () => "timeout");
  const first = await p;
  await later(120, null);
  const second = await p;
  settledTwice = first === second ? 1 : 2;
  assert.equal(first, "timeout");
  assert.equal(settledTwice, 1, "promise must stay settled at the timeout value");
});

test("in-flight guard: a still-busy ticker is skipped, not stacked", async () => {
  // Without this the deadline leaks: a permanently slow name gets a fresh call every 5s while the
  // old ones still run, trading a cadence bug for an unbounded resource leak.
  const g = makeInFlightGuard();
  let starts = 0;
  const slow = () => {
    starts += 1;
    return later(200, true);
  };
  const a = g.run("NVDA", slow, () => false);
  const b = await g.run("NVDA", slow, () => false);
  assert.equal(b, false, "second call while busy is refused");
  assert.equal(starts, 1, "the slow work must not be started twice");
  await a;
});

test("in-flight guard: the key frees when the WORK settles, not when a deadline fires", async () => {
  const g = makeInFlightGuard();
  let starts = 0;
  const work = () => {
    starts += 1;
    return later(60, true);
  };
  await g.run("SPY", work, () => false);
  assert.equal(g.size(), 0, "settled work releases its key");
  await g.run("SPY", work, () => false);
  assert.equal(starts, 2, "an idle ticker runs again on the next tick");
});

test("in-flight guard: a REJECTING ticker still releases its key", async () => {
  // A name that throws every tick must not be locked out forever.
  const g = makeInFlightGuard();
  await assert.rejects(g.run("BAD", () => Promise.reject(new Error("x")), () => false));
  assert.equal(g.size(), 0, "a rejection must not leak the key");
});
