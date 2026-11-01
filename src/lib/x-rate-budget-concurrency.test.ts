import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// REGRESSION (round 111): recordBudgetUse used to do an UNLOCKED read-modify-write
// (loadDayBudget -> mutate -> saveDayBudget) against the shared per-day Postgres row. Two
// concurrent callers — x-growth and x-engage are separate cron routes that both call the
// SAME runEngagementSweep, and x-autopost/x-mention-replies write the same row too — can
// interleave: both read the same base value before either writes, so the second write
// clobbers the first and one increment is lost ("lost update"). That silently undercounts
// real X API usage against X_DAILY_CAPS, defeating the whole point of the cap.
//
// Fake `getMeta`/`setMeta` below model exactly that interleaving: getMeta resolves on a
// macrotask tick (like a real network round-trip) so two concurrent calls both read the
// pre-increment value before either call's setMeta lands. Fake `tryAdvisoryLock`/
// `releaseAdvisoryLock` model a real Postgres session-scoped advisory lock: non-blocking
// "try" semantics, held by at most one caller at a time.

let store = new Map<string, string>();
let lockHolder: symbol | null = null;

function makeDbMock() {
  return {
    namedExports: {
      getMeta: async (key: string): Promise<string | null> => {
        const value = store.get(key) ?? null;
        // Force a real async gap so two concurrent recordBudgetUse calls both read BEFORE
        // either writes — the exact interleaving that produces a lost update.
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
mock.module("./x-marketing-env", { namedExports: { xGrowthIntensive: () => false } });

async function loadModule() {
  return import("./x-rate-budget");
}

describe("x-rate-budget concurrency (recordBudgetUse)", () => {
  it("two concurrent increments for the SAME action both land (no lost update)", async () => {
    const { recordBudgetUse, getDayBudgetSnapshot } = await loadModule();
    store = new Map();
    lockHolder = null;

    // x-growth and x-engage both recording a "likes" use for the same tick, concurrently.
    await Promise.all([recordBudgetUse("likes"), recordBudgetUse("likes")]);

    const snapshot = await getDayBudgetSnapshot();
    assert.equal(
      snapshot.likes,
      2,
      "both concurrent recordBudgetUse('likes') calls must be reflected — a lost update would read 1",
    );
  });

  it("concurrent increments for DIFFERENT actions both land", async () => {
    const { recordBudgetUse, getDayBudgetSnapshot } = await loadModule();
    store = new Map();
    lockHolder = null;

    await Promise.all([
      recordBudgetUse("likes"),
      recordBudgetUse("follows"),
      recordBudgetUse("replies"),
    ]);

    const snapshot = await getDayBudgetSnapshot();
    assert.equal(snapshot.likes, 1);
    assert.equal(snapshot.follows, 1);
    assert.equal(snapshot.replies, 1);
  });

  it("many concurrent increments for the same action all land", async () => {
    const { recordBudgetUse, getDayBudgetSnapshot } = await loadModule();
    store = new Map();
    lockHolder = null;

    const N = 8;
    await Promise.all(Array.from({ length: N }, () => recordBudgetUse("retweets")));

    const snapshot = await getDayBudgetSnapshot();
    assert.equal(snapshot.retweets, N, `expected all ${N} increments to land, lost updates would undercount`);
  });
});
