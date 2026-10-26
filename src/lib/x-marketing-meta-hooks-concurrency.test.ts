import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// REGRESSION (round 113, sibling of round 111's x-rate-budget-concurrency.test.ts and round
// 112's x-marketing-meta-concurrency.test.ts): recordPostHook used to do an UNLOCKED
// read-modify-write (getRecentPostHooks -> push -> writeMeta) against the shared
// `x_marketing_recent_hooks` Postgres row. recordPostHook has exactly one call site
// (x-autopost/route.ts's post-success path), so the realistic interleaving is two overlapping
// invocations of that SAME route (e.g. two manual `?force=1` triggers close together, or a
// manual run racing a re-enabled scheduled fire) rather than two different cron TYPES racing —
// but the lost-update shape is identical: both reads see the same base array before either
// write lands, so the second write clobbers the first and one hook is silently dropped. A
// dropped hook weakens x-content-dedup.ts's near-duplicate check for the next generated post.
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
        // Force a real async gap so two concurrent recordPostHook calls both read BEFORE
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

describe("x-marketing-meta concurrency (recordPostHook)", () => {
  it("two concurrent recordPostHook calls for DIFFERENT bodies both land (no lost update)", async () => {
    const { recordPostHook, getRecentPostHooks } = await loadModule();
    store = new Map();
    lockHolder = null;

    // Two overlapping x-autopost invocations (e.g. a manual force run racing another)
    // posting different content at the same tick.
    await Promise.all([
      recordPostHook("SPY gamma flip at 580 — dealers are long here"),
      recordPostHook("NVDA call wall building at 950 into expiry"),
    ]);

    const hooks = await getRecentPostHooks();
    assert.ok(
      hooks.includes("SPY gamma flip at 580 — dealers are long here"),
      "first concurrent hook must be recorded — a lost update would drop it",
    );
    assert.ok(
      hooks.includes("NVDA call wall building at 950 into expiry"),
      "second concurrent hook must be recorded — a lost update would drop it",
    );
  });

  it("many concurrent recordPostHook calls all land", async () => {
    const { recordPostHook, getRecentPostHooks } = await loadModule();
    store = new Map();
    lockHolder = null;

    const N = 8;
    const bodies = Array.from({ length: N }, (_, i) => `hook body number ${i}`);
    await Promise.all(bodies.map((b) => recordPostHook(b)));

    const hooks = await getRecentPostHooks();
    for (const b of bodies) {
      assert.ok(hooks.includes(b), `expected "${b}" to be recorded — lost updates would drop some`);
    }
    assert.equal(hooks.length, N, `expected all ${N} hooks to land, lost updates would undercount`);
  });

  it("empty/whitespace-only bodies are rejected without touching the lock or store", async () => {
    const { recordPostHook, getRecentPostHooks } = await loadModule();
    store = new Map();
    lockHolder = null;

    await recordPostHook("   ");
    const hooks = await getRecentPostHooks();
    assert.equal(hooks.length, 0, "a whitespace-only body must not be recorded as a hook");
  });
});
