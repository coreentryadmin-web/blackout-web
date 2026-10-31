import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// REGRESSION (round 114, sibling of round 111's x-rate-budget-concurrency.test.ts and round
// 112/113's x-marketing-meta races): bumpEngageRotation used to do an UNLOCKED
// read-modify-write (getEngageRotationIndex -> compute next -> writeMeta) against the shared
// `x_marketing_engage_rotation` Postgres row. `x-growth` and `x-engage` are separate cron
// routes that both call the SAME runEngagementSweep, which bumps this row once per sweep to
// rotate which engagement targets get picked next. Two concurrent sweeps can interleave: both
// read the same base index, both compute `base + 1`, both write — the second write clobbers
// the first and one rotation step is silently lost (a classic lost update, same shape as the
// budget-counter and replied-ids races already fixed).
//
// Fake `getMeta`/`setMeta` below model exactly that interleaving: getMeta resolves on a
// macrotask tick (like a real network round-trip) so two concurrent bumpEngageRotation calls
// both read BEFORE either writes — the exact interleaving that produces a lost update. Fake
// `tryAdvisoryLock`/`releaseAdvisoryLock` model a real Postgres session-scoped advisory lock:
// non-blocking "try" semantics, held by at most one caller at a time.

let store = new Map<string, string>();
let lockHolder: symbol | null = null;

function makeDbMock() {
  return {
    namedExports: {
      getMeta: async (key: string): Promise<string | null> => {
        const value = store.get(key) ?? null;
        // Force a real async gap so two concurrent bumpEngageRotation calls both read BEFORE
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

async function loadModule() {
  return import("./x-marketing-meta");
}

describe("x-marketing-meta concurrency (bumpEngageRotation)", () => {
  it("two concurrent bumps from a 0 base both advance the index (no lost update)", async () => {
    const { bumpEngageRotation, getEngageRotationIndex } = await loadModule();
    store = new Map();
    lockHolder = null;

    // x-growth and x-engage racing the SAME underlying ENGAGE_ROTATION_KEY row at the same
    // tick. A lost update would leave the final stored index at 1 instead of 2.
    const results = await Promise.all([
      bumpEngageRotation(),
      bumpEngageRotation(),
    ]);

    const final = await getEngageRotationIndex();
    assert.equal(
      final,
      2,
      "both concurrent bumps must be reflected — a lost update would leave the index at 1",
    );
    // Each caller should see a distinct step, not both seeing the same clobbered value.
    assert.deepEqual([...results].sort(), [1, 2]);
  });

  it("many concurrent bumps all advance the index by exactly one each", async () => {
    const { bumpEngageRotation, getEngageRotationIndex } = await loadModule();
    store = new Map();
    lockHolder = null;

    const N = 8;
    await Promise.all(Array.from({ length: N }, () => bumpEngageRotation()));

    const final = await getEngageRotationIndex();
    assert.equal(
      final,
      N,
      `expected the index to advance by exactly ${N} — lost updates would undercount`,
    );
  });

  it("wraps modulo 1000 even under concurrent bumps near the boundary", async () => {
    const { bumpEngageRotation, getEngageRotationIndex } = await loadModule();
    store = new Map([["x_marketing_engage_rotation", "998"]]);
    lockHolder = null;

    await Promise.all([bumpEngageRotation(), bumpEngageRotation()]);

    const final = await getEngageRotationIndex();
    assert.equal(final, 0, "998 -> 999 -> 0 under two serialized bumps, no lost update");
  });
});
