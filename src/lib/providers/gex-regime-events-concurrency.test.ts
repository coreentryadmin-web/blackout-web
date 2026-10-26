import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// REGRESSION (round 114, sibling of x-rate-budget-concurrency.test.ts and
// x-marketing-meta's own rotation/replied-ids concurrency tests): persistGexRegimeEvents used
// to do an UNLOCKED read-modify-write (loadCursor -> diff -> insert(s) -> saveCursor) against
// the SINGLE shared `gex_regime_event_cursor` Postgres row — a GLOBAL cursor map keyed by
// `${ticker}|${type}:${direction}`, covering EVERY ticker in one JSON blob, not one row per
// ticker. The per-ticker cluster build lock in polygon-options-gex.ts only serializes two
// builds of the SAME ticker; it does nothing for two DIFFERENT tickers (e.g. SPY and NVDA)
// whose cache-miss builds land on two different replicas at the same moment and both call
// persistGexRegimeEvents concurrently. If both read the same base cursor map before either
// saves, whichever write lands last clobbers the other ticker's newly-recorded slot(s) — a
// lost update that causes the NEXT sample to see that clobbered ticker's transition as "new"
// again and insert a DUPLICATE durable row for it.
//
// Fake `getMeta`/`setMeta` below model exactly that interleaving: getMeta resolves on a
// macrotask tick (like a real network round-trip) so two concurrent persistGexRegimeEvents
// calls for DIFFERENT tickers both read BEFORE either writes — the exact interleaving that
// produces a lost update. Fake `tryAdvisoryLock`/`releaseAdvisoryLock` model a real Postgres
// session-scoped advisory lock: non-blocking "try" semantics, held by at most one caller at a
// time.

let store = new Map<string, string>();
let lockHolder: symbol | null = null;
let inserted: Array<Record<string, unknown>> = [];

function makeDbMock() {
  return {
    namedExports: {
      dbConfigured: () => true,
      getMeta: async (key: string): Promise<string | null> => {
        const value = store.get(key) ?? null;
        // Force a real async gap so two concurrent persistGexRegimeEvents calls (different
        // tickers) both read BEFORE either writes.
        await new Promise((r) => setTimeout(r, 5));
        return value;
      },
      setMeta: async (key: string, value: string): Promise<void> => {
        if (value === "") store.delete(key);
        else store.set(key, value);
      },
      insertGexRegimeEvent: async (row: Record<string, unknown>): Promise<void> => {
        inserted.push(row);
      },
      fetchGexRegimeEventRows: async (): Promise<unknown[]> => [],
      tryAdvisoryLock: async (_lockKey: string): Promise<boolean> => {
        if (lockHolder !== null) return false;
        lockHolder = Symbol();
        return true;
      },
      releaseAdvisoryLock: async (_lockKey: string): Promise<void> => {
        lockHolder = null;
      },
    },
  };
}

mock.module("../db", makeDbMock());
mock.module("./spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-06" },
});

async function loadModule() {
  return import("./gex-regime-events");
}

function ev(type: "flip_crossed" | "wall_broken", direction: string) {
  return {
    type,
    severity: "info" as const,
    message: `${type} ${direction}`,
    level: 100,
    direction,
    from_value: 1,
    to_value: 2,
    at: "2026-07-06T14:00:00.000Z",
  };
}

describe("gex-regime-events concurrency (persistGexRegimeEvents)", () => {
  it("two different tickers persisting concurrently both land their cursor slot (no lost update)", async () => {
    const { persistGexRegimeEvents } = await loadModule();
    store = new Map();
    lockHolder = null;
    inserted = [];

    // Two different tickers' cache-miss builds on two different replicas, racing the SAME
    // global cursor row at the same tick.
    await Promise.all([
      persistGexRegimeEvents("SPY", [ev("flip_crossed", "up")]),
      persistGexRegimeEvents("NVDA", [ev("wall_broken", "call")]),
    ]);

    assert.equal(inserted.length, 2, "both tickers' first-time events should insert exactly once");

    // The crux of the regression: re-running the SAME two events again must NOT insert again.
    // Before the fix, the lost update meant whichever ticker's slot got clobbered would look
    // "new" again here and insert a duplicate row.
    await Promise.all([
      persistGexRegimeEvents("SPY", [ev("flip_crossed", "up")]),
      persistGexRegimeEvents("NVDA", [ev("wall_broken", "call")]),
    ]);

    assert.equal(
      inserted.length,
      2,
      "re-persisting the SAME already-seen transitions must stay throttled — a lost update " +
        "would have let one ticker's clobbered cursor slot re-insert a duplicate row",
    );
  });

  it("many different tickers persisting concurrently all land their own cursor slot", async () => {
    const { persistGexRegimeEvents } = await loadModule();
    store = new Map();
    lockHolder = null;
    inserted = [];

    const tickers = ["SPY", "SPX", "QQQ", "IWM", "NVDA", "TSLA", "META", "AMD"];
    await Promise.all(
      tickers.map((t) => persistGexRegimeEvents(t, [ev("flip_crossed", "up")])),
    );
    assert.equal(inserted.length, tickers.length, "every ticker's first event should insert once");

    // Second wave: none of these should re-insert if every slot truly landed in the cursor.
    await Promise.all(
      tickers.map((t) => persistGexRegimeEvents(t, [ev("flip_crossed", "up")])),
    );
    assert.equal(
      inserted.length,
      tickers.length,
      "no ticker's cursor slot should have been lost — a race would cause re-inserts here",
    );
  });
});
