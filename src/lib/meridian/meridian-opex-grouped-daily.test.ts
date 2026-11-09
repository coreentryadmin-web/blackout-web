import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOpexGroupedDailyOrEmpty } from "./meridian-opex-grouped-daily";

/**
 * Minimal fake TTL cache mirroring `server-cache.ts`'s real contract precisely: a loader's
 * success is written into `store`; a loader's REJECTION is never written — it just increments
 * a call counter and rethrows, same as `withServerCache`/`refreshCache`'s own `.then`-only
 * `setStoreEntry` call.
 */
function makeFakeCache() {
  const store = new Map<string, unknown>();
  let loaderCalls = 0;
  async function cached<T>(key: string, _ttlMs: number, loader: () => Promise<T[]>): Promise<T[]> {
    if (store.has(key)) return store.get(key) as T[];
    loaderCalls += 1;
    const value = await loader(); // rejection propagates to the caller untouched
    store.set(key, value);
    return value;
  }
  return { cached, store, getLoaderCalls: () => loaderCalls };
}

test("loadOpexGroupedDailyOrEmpty: a loader failure is NOT cached — the next call retries", async () => {
  const { cached, store, getLoaderCalls } = makeFakeCache();
  let attempt = 0;
  const loader = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("polygon grouped-daily down");
    return [{ T: "AAPL" }];
  };

  const first = await loadOpexGroupedDailyOrEmpty(cached, "k", 1000, loader);
  assert.deepEqual(first, [], "a failed first call returns the empty fallback, not a throw");
  assert.equal(store.has("k"), false, "the failure must never be written into the cache store");

  const second = await loadOpexGroupedDailyOrEmpty(cached, "k", 1000, loader);
  assert.deepEqual(second, [{ T: "AAPL" }], "the second call actually retries the upstream");
  assert.equal(getLoaderCalls(), 2, "both calls invoked the loader — no stale fallback was replayed");
});

test("loadOpexGroupedDailyOrEmpty: a genuinely empty result still caches normally", async () => {
  const { cached, store, getLoaderCalls } = makeFakeCache();
  const loader = async () => [] as { T: string }[];

  const first = await loadOpexGroupedDailyOrEmpty(cached, "k2", 1000, loader);
  assert.deepEqual(first, []);
  assert.equal(store.has("k2"), true, "a real empty success is a cacheable fact, unlike a failure");

  const second = await loadOpexGroupedDailyOrEmpty(cached, "k2", 1000, loader);
  assert.deepEqual(second, []);
  assert.equal(getLoaderCalls(), 1, "the cached empty result was served without re-invoking the loader");
});

test("REGRESSION (the exact bug): catching INSIDE the loader caches a failure as empty forever", async () => {
  const { cached, store, getLoaderCalls } = makeFakeCache();
  let attempt = 0;
  const buggyLoader = async (): Promise<{ T: string }[]> => {
    attempt += 1;
    if (attempt === 1) throw new Error("polygon grouped-daily down");
    return [{ T: "AAPL" }];
  };
  // Deliberately re-creates the original buggy shape for contrast: the catch lives inside the
  // function handed to `cached(...)`, so `cached` itself never observes the rejection.
  const wrappedBuggyLoader = async () => {
    try {
      return await buggyLoader();
    } catch {
      return [] as { T: string }[];
    }
  };

  const first = await cached("k3", 1000, wrappedBuggyLoader);
  assert.deepEqual(first, []);
  assert.equal(store.has("k3"), true, "the buggy shape DOES write the empty fallback into the cache");

  const second = await cached("k3", 1000, wrappedBuggyLoader);
  assert.deepEqual(second, [], "the second call replays the stale fallback instead of retrying");
  assert.equal(getLoaderCalls(), 1, "only ONE loader invocation ever happened — the bug this file fixes");
});
