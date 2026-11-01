import assert from "node:assert/strict";
import { test } from "node:test";
import { runTickerSelectGuardedLoad } from "./vector-ticker-select-guard";

/**
 * Regression (round 242, DISCOVERY lane): see vector-ticker-select-guard.ts's own header for the
 * full race this closes. Summary: VectorPageClient's `onTickerSelect` (wired to the ticker
 * scanner, comparison strip, and ticker-select dropdown via `navigateTicker`) used to fetch the
 * next ticker's seed and apply it with no protection against out-of-order resolution. Clicking
 * ticker A, then ticker B before A's fetch resolves, started two concurrent fetches guarded only
 * by comparing against the SAME still-stale `seed.ticker` — so whichever fetch settled LAST won,
 * regardless of click order.
 *
 * This test proves the fix directly against the real exported function, with no React rendering
 * needed: two "clicks" (older generation 1 for ticker A, newer generation 2 for ticker B) resolve
 * in REVERSE order (A's fetch settles after B's) — exactly the ordering that exposed the bug —
 * and asserts the final observed seed is B's, never overwritten by A's late arrival.
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("runTickerSelectGuardedLoad: a stale (older-generation) ticker fetch resolving AFTER the current one does not overwrite its seed", async () => {
  let current = 0;
  const currentGeneration = () => current;

  const reqA = deferred<{ ticker: string }>(); // clicked first, slower
  const reqB = deferred<{ ticker: string }>(); // clicked second, faster

  let appliedSeed: { ticker: string } | null = null;
  let navBusy = false;
  let settleCount = 0;

  current = 1;
  const runA = runTickerSelectGuardedLoad(1, currentGeneration, () => reqA.promise, {
    onSuccess: (d) => {
      appliedSeed = d;
    },
    onSettle: () => {
      navBusy = false;
      settleCount++;
    },
  });
  navBusy = true;

  // Member clicks a different ticker before A's seed fetch resolves — bumps the generation, same
  // as onTickerSelect does on every call.
  current = 2;
  const runB = runTickerSelectGuardedLoad(2, currentGeneration, () => reqB.promise, {
    onSuccess: (d) => {
      appliedSeed = d;
    },
    onSettle: () => {
      navBusy = false;
      settleCount++;
    },
  });
  navBusy = true;

  // B's (the currently-selected ticker's) fetch resolves FIRST.
  reqB.resolve({ ticker: "B" });
  await runB;
  assert.deepEqual(appliedSeed, { ticker: "B" }, "newer generation's seed should apply");
  assert.equal(navBusy, false, "newer generation's settle should clear navBusy");
  assert.equal(settleCount, 1);

  // A's (the stale, already-abandoned ticker's) fetch resolves SECOND — this is the exact
  // ordering that corrupted the desk before the fix.
  reqA.resolve({ ticker: "A" });
  await runA;

  assert.deepEqual(
    appliedSeed,
    { ticker: "B" },
    "a late-arriving stale ticker fetch must never overwrite the current generation's seed"
  );
  assert.equal(settleCount, 1, "stale request's onSettle must not fire a second time");
});

test("runTickerSelectGuardedLoad: the normal (non-raced) resolution still applies cleanly", async () => {
  let current = 1;
  const currentGeneration = () => current;
  let appliedSeed: { ticker: string } | null = null;
  let settled = false;

  await runTickerSelectGuardedLoad(1, currentGeneration, async () => ({ ticker: "AAPL" }), {
    onSuccess: (d) => {
      appliedSeed = d;
    },
    onSettle: () => {
      settled = true;
    },
  });

  assert.deepEqual(appliedSeed, { ticker: "AAPL" });
  assert.equal(settled, true);
});
