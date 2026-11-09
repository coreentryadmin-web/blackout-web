import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWithFailureIsolatedCache } from "./peer-reaction-cache-wrap";

/**
 * A minimal in-memory TTL cache with the exact `cached(key, ttlMs, loader)` shape
 * `server-cache.ts`'s `serverCache`/`withServerCache` export — importantly, it only ever
 * writes a value into its store on the loader's SUCCESS branch (`.then`), exactly like the
 * real `refreshCache` in `server-cache.ts` ("Failing keys never enter `store`"). A rejection
 * propagates to the caller untouched. This is what makes the test exercise the real bug
 * SHAPE (a cache that only stores on success) without pulling in Redis/background-refresh.
 */
function makeFakeTtlCache() {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    store,
    cached: async <T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> => {
      const hit = store.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.value as T;
      const value = await loader(); // rejection propagates untouched — nothing caught here
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    },
  };
}

test("loadWithFailureIsolatedCache: a loader failure is NOT cached — the next call retries", async () => {
  const { cached, store } = makeFakeTtlCache();
  let calls = 0;
  const loader = async () => {
    calls++;
    if (calls === 1) throw new Error("transient rate limit");
    return { ok: true, value: "real-data" };
  };

  const first = await loadWithFailureIsolatedCache(cached, "k", 6 * 60 * 60 * 1000, loader, () => ({
    ok: false,
    value: "no-data",
  }));
  assert.deepEqual(first, { ok: false, value: "no-data" });
  // The critical assertion: the failure fallback must never land in the cache store. If it
  // did (the pre-fix bug — catching INSIDE the cached loader turns a failure into a
  // "successful" no-data load from the cache's point of view), this would be non-empty and
  // the second call below would read back the stale fallback instead of retrying.
  assert.equal(store.size, 0, "a failed load must not be cached");

  const second = await loadWithFailureIsolatedCache(cached, "k", 6 * 60 * 60 * 1000, loader, () => ({
    ok: false,
    value: "no-data",
  }));
  assert.deepEqual(second, { ok: true, value: "real-data" }, "retried and got the real value, not a frozen fallback");
  assert.equal(calls, 2, "the loader ran again on the second call instead of serving a cached failure");
});

test("loadWithFailureIsolatedCache: a successful load IS cached normally (loader not re-invoked)", async () => {
  const { cached } = makeFakeTtlCache();
  let calls = 0;
  const loader = async () => {
    calls++;
    return "value";
  };

  const first = await loadWithFailureIsolatedCache(cached, "k2", 60_000, loader, () => "fallback");
  const second = await loadWithFailureIsolatedCache(cached, "k2", 60_000, loader, () => "fallback");
  assert.equal(first, "value");
  assert.equal(second, "value");
  assert.equal(calls, 1, "the second call hit the cache instead of re-invoking the loader");
});

test("loadWithFailureIsolatedCache: demonstrates the ORIGINAL bug pattern for contrast — catching inside the loader poisons the cache for the TTL", async () => {
  const { cached, store } = makeFakeTtlCache();
  let calls = 0;
  // This reproduces the OLD, buggy shape verbatim: the try/catch lives INSIDE the function
  // passed to `cached`, so a failure never reaches the cache as a rejection.
  const buggyWrapped = async (key: string, ttlMs: number) =>
    cached(key, ttlMs, async () => {
      calls++;
      try {
        if (calls === 1) throw new Error("transient rate limit");
        return "real-data";
      } catch {
        return "no-data";
      }
    });

  const first = await buggyWrapped("k3", 6 * 60 * 60 * 1000);
  assert.equal(first, "no-data");
  // Under the bug pattern, the fallback DOES get cached (this is exactly the defect fixed by
  // moving the catch outside `cached`).
  assert.equal(store.size, 1, "bug pattern: the fallback was cached as if it were real data");

  const second = await buggyWrapped("k3", 6 * 60 * 60 * 1000);
  assert.equal(second, "no-data", "bug pattern: frozen fallback served even though the loader would now succeed");
  assert.equal(calls, 1, "bug pattern: the loader never ran again — the cache masked the retry opportunity");
});
