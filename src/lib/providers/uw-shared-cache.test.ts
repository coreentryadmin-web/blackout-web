import { test } from "node:test";
import assert from "node:assert/strict";

// uw-shared-cache.ts had no dedicated test file before Phase 2 (the AbortSignal cancellation
// fix, 2026-09-17) — these cover the coalescing/cancellation wiring `uwCacheGet` gained via
// coalesced-abort-group.ts. The primitive itself (createCoalescedRequestGroup) already has an
// exhaustive suite in coalesced-abort-group.test.ts; these tests are specifically about THIS
// module's own `_inflight` Map usage, which the primitive's own tests can't see.

test("uwCacheGet: two concurrent callers for the same key share ONE underlying fetch", async () => {
  const { uwCacheGet } = await import("./uw-shared-cache");
  let fetchCount = 0;
  let resolveFetch!: (v: string) => void;
  const inFlight = new Promise<string>((r) => {
    resolveFetch = r;
  });

  const key = `coalesce-test-${Date.now()}`;
  const p1 = uwCacheGet(null, key, 60, () => {
    fetchCount += 1;
    return inFlight;
  });
  const p2 = uwCacheGet(null, key, 60, () => {
    fetchCount += 1;
    return inFlight;
  });

  resolveFetch("shared-value");
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, "shared-value");
  assert.equal(r2, "shared-value");
  assert.equal(fetchCount, 1, "only the FIRST caller's fetcher should ever run — the second must join, not re-fetch");
});

// THE ORPHANED-ENTRY REGRESSION THIS GUARDS: before the group's own settle-triggered cleanup
// (`void group.promise.catch(() => {}).finally(() => { if (_inflight.get(key) === group)
// _inflight.delete(key) })`), a caller that aborted the ONLY in-flight request for a key could
// leave that key's `_inflight` entry pointing at an already-rejected, dead group forever — every
// future caller for that same key would then join the SAME dead group and immediately re-reject
// with the FIRST caller's stale abort reason, rather than ever running a fresh fetch again.
test("uwCacheGet: aborting the only caller cleans up the key's _inflight entry — a later call for the SAME key runs its own fresh fetch, not a dead group's stale rejection", async () => {
  const { uwCacheGet } = await import("./uw-shared-cache");
  const key = `orphan-test-${Date.now()}`;
  let fetchCount = 0;

  const controller = new AbortController();
  const first = uwCacheGet(
    null,
    key,
    60,
    (signal) =>
      new Promise((_, reject) => {
        fetchCount += 1;
        signal?.addEventListener("abort", () => reject(signal.reason));
      }),
    controller.signal
  );
  first.catch(() => {});

  controller.abort();
  await assert.rejects(first);

  // Let the group's own cleanup .finally() run (it's chained off the same settled promise as
  // `first`, in a separate reaction — see coalesced-abort-group.ts's attach()/detach()). A real
  // caller in production always has at least this much of a gap (another async hop) between one
  // ticker's abort and the next ticker's own call for the same key.
  await new Promise((r) => setImmediate(r));

  const second = await uwCacheGet(null, key, 60, () => {
    fetchCount += 1;
    return Promise.resolve("second-value");
  });
  assert.equal(second, "second-value", "REGRESSION: a leaked _inflight entry would instead re-reject with the first call's abort reason");
  assert.equal(fetchCount, 2, "the second call must trigger its OWN fetch — the key must not still be occupied by a dead group");
});

// THE SUBTLE, WORTH-DOCUMENTING CONTRACT: a coalesced group has exactly ONE outcome — it is not
// possible for caller A to reject "early" while caller B keeps waiting on a DIFFERENT, still-live
// outcome of the very same shared request. Aborting A's own signal while B is still attached only
// decrements A's waiter slot (so the group can still be torn down later, once B ALSO detaches
// without the request having settled) — it does NOT make A's own uwCacheGet(...) call settle
// ahead of B's. Real callers get prompt per-caller cancellation from the OUTER race they wrap this
// in (dossierFetch's Promise.race against its own wall timer, per fetch-timeout.ts) — not from
// uwCacheGet/throttleUwCoalesced settling independently per caller. Documented here so a future
// caller that awaits uwCacheGet/throttleUwCoalesced DIRECTLY (no outer race of its own) doesn't
// assume passing a signal alone gives it prompt cancellation while other callers remain attached.
test("uwCacheGet: caller A aborting while B is still attached does NOT settle A's own promise early — both resolve TOGETHER once the shared request itself does", async () => {
  const { uwCacheGet } = await import("./uw-shared-cache");
  const key = `no-early-settle-${Date.now()}`;
  let resolveFetch!: (v: string) => void;
  const inFlight = new Promise<string>((r) => {
    resolveFetch = r;
  });

  const controllerA = new AbortController();
  const pendingA = uwCacheGet(null, key, 60, () => inFlight, controllerA.signal);
  const pendingB = uwCacheGet(null, key, 60, () => inFlight); // no signal — B never asked to cancel
  pendingA.catch(() => {});

  controllerA.abort();

  let aSettled = false;
  let bSettled = false;
  pendingA.then(
    () => (aSettled = true),
    () => (aSettled = true)
  );
  pendingB.then(() => (bSettled = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(aSettled, false, "A's abort only decrements its waiter slot — it must not settle A's own promise while B remains attached");
  assert.equal(bSettled, false, "B must still be waiting on the live shared request after A's abort");

  resolveFetch("resolved-for-both");
  assert.equal(await pendingA, "resolved-for-both", "A shares the SAME final outcome as B, since it's one coalesced request");
  assert.equal(await pendingB, "resolved-for-both");
});
