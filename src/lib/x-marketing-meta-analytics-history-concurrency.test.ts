import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// REGRESSION (round 117, sibling of round 113's x-marketing-meta-hooks-concurrency.test.ts,
// round 112's x-marketing-meta-concurrency.test.ts, and round 111's
// x-rate-budget-concurrency.test.ts): saveAnalyticsSnapshot used to append to
// ANALYTICS_HISTORY_KEY with an UNLOCKED read-modify-write (readMeta -> push -> writeMeta)
// against the shared `x_marketing_analytics_history` Postgres row. x-analytics is a once-daily
// cron (cron-registry.ts, `30 23 * * *`), but scripts/x-marketing-audit.mjs hits
// `GET /api/cron/x-analytics` directly (no `?dry=1`) to pull a fresh snapshot for its own audit
// output — a manual audit run overlapping the scheduled fire, or two overlapping manual audit
// runs, is a real interleaving. Both reads see the same base history array before either write
// lands, so the second write clobbers the first and one whole snapshot is silently dropped from
// history.
//
// Fake `getMeta`/`setMeta` below model exactly that interleaving: getMeta resolves on a
// macrotask tick (like a real network round-trip) so two concurrent calls both read the
// pre-update value before either call's setMeta lands. Fake `tryAdvisoryLock`/
// `releaseAdvisoryLock` model a real Postgres session-scoped advisory lock: non-blocking
// "try" semantics, held by at most one caller at a time.

let store = new Map<string, string>();
let lockHolder: symbol | null = null;

function makeDbMock() {
  return {
    namedExports: {
      getMeta: async (key: string): Promise<string | null> => {
        const value = store.get(key) ?? null;
        // Force a real async gap so two concurrent saveAnalyticsSnapshot calls both read
        // BEFORE either writes — the exact interleaving that produces a lost update.
        await new Promise((r) => setTimeout(r, 5));
        return value;
      },
      setMeta: async (key: string, value: string): Promise<void> => {
        if (value === "") store.delete(key);
        else store.set(key, value);
      },
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

mock.module("./db", makeDbMock());

async function loadModule() {
  return import("./x-marketing-meta");
}

function snapAt(at: string) {
  return {
    at,
    followers: 100,
    following: 10,
    tweet_count: 50,
    recent_tweets: [],
  };
}

describe("x-marketing-meta concurrency (saveAnalyticsSnapshot history)", () => {
  it("two concurrent saveAnalyticsSnapshot calls both land in history (no lost update)", async () => {
    const { saveAnalyticsSnapshot, getAnalyticsHistory } = await loadModule();
    store = new Map();
    lockHolder = null;

    // A scheduled daily fire racing a manual audit-script trigger of the same route.
    await Promise.all([
      saveAnalyticsSnapshot(snapAt("2026-10-26T23:30:00.000Z")),
      saveAnalyticsSnapshot(snapAt("2026-10-26T23:30:01.000Z")),
    ]);

    const history = await getAnalyticsHistory(90);
    const stamps = history.map((h) => h.at);
    assert.ok(
      stamps.includes("2026-10-26T23:30:00.000Z"),
      "first concurrent snapshot must be recorded — a lost update would drop it",
    );
    assert.ok(
      stamps.includes("2026-10-26T23:30:01.000Z"),
      "second concurrent snapshot must be recorded — a lost update would drop it",
    );
    assert.equal(history.length, 2, "both snapshots must land, lost updates would undercount");
  });

  it("many concurrent saveAnalyticsSnapshot calls all land", async () => {
    const { saveAnalyticsSnapshot, getAnalyticsHistory } = await loadModule();
    store = new Map();
    lockHolder = null;

    const N = 8;
    const stamps = Array.from({ length: N }, (_, i) => `2026-10-26T23:3${i}:00.000Z`);
    await Promise.all(stamps.map((at) => saveAnalyticsSnapshot(snapAt(at))));

    const history = await getAnalyticsHistory(N + 1);
    const got = history.map((h) => h.at);
    for (const at of stamps) {
      assert.ok(got.includes(at), `expected "${at}" to be recorded — lost updates would drop some`);
    }
    assert.equal(history.length, N, `expected all ${N} snapshots to land, lost updates would undercount`);
  });

  it("the latest-snapshot pointer still reflects the most recently saved snapshot", async () => {
    const { saveAnalyticsSnapshot, getLatestAnalytics } = await loadModule();
    store = new Map();
    lockHolder = null;

    await saveAnalyticsSnapshot(snapAt("2026-10-26T23:30:00.000Z"));
    await saveAnalyticsSnapshot(snapAt("2026-10-26T23:31:00.000Z"));

    const latest = await getLatestAnalytics();
    assert.equal(latest?.at, "2026-10-26T23:31:00.000Z");
  });
});
