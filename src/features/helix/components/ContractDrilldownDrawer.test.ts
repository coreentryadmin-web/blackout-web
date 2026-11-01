import assert from "node:assert/strict";
import { test } from "node:test";
import { runGenerationGuardedLoad } from "./ContractDrilldownDrawer";

/**
 * Regression (round 231, DISCOVERY lane): `ContractDrilldownDrawer`'s `load`/`loadHistory` fetches
 * had no protection against out-of-order resolution. Clicking print A starts a fetch for A;
 * clicking print B (a different contract) before A's fetch resolves starts a second fetch for B.
 * Network timing — not click order — decides which promise settles LAST. If A's response arrives
 * after B's, the old code did `setData(dataForA)`/`setHistory(historyForA)` unconditionally,
 * overwriting B's already-correct data with A's — while the drawer's header (driven straight off
 * the `flow` prop, not the fetch) still correctly showed B. The member would see B's ticker/strike
 * in the title with A's OI/intraday-chart/fills/history underneath it.
 *
 * `runGenerationGuardedLoad` is the extracted guard both `load` and `loadHistory` now share: each
 * request carries its own generation id, and the id is re-checked against the LATEST generation at
 * settle time, discarding (never applying) a stale result — the same pattern TickerDrawer.tsx's
 * own `loadGenerationRef` already uses for its sibling fetch pair (there labeled "Bug 13").
 *
 * This test proves the invariant directly against the real exported function, with no React
 * rendering needed: two "requests" (older generation 1, newer generation 2) resolve in REVERSE
 * order (1 after 2) — exactly the ordering that exposes the bug — and asserts the final observed
 * state is generation 2's, never overwritten by generation 1's late arrival.
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("runGenerationGuardedLoad: a stale (older-generation) request resolving AFTER the current one does not overwrite its result", async () => {
  let current = 0;
  const currentGeneration = () => current;

  const reqA = deferred<string>(); // older, slower
  const reqB = deferred<string>(); // newer, faster

  let applied: string | null = null;
  let settleCount = 0;

  current = 1;
  const runA = runGenerationGuardedLoad(1, currentGeneration, () => reqA.promise, {
    onStart: () => {},
    onSuccess: (d) => {
      applied = d;
    },
    onError: () => {
      applied = "ERROR_A";
    },
    onSettle: () => {
      settleCount++;
    },
  });

  // User clicks a different contract before A resolves — bumps the generation, same as the
  // component's effect does on every `flow` change.
  current = 2;
  const runB = runGenerationGuardedLoad(2, currentGeneration, () => reqB.promise, {
    onStart: () => {},
    onSuccess: (d) => {
      applied = d;
    },
    onError: () => {
      applied = "ERROR_B";
    },
    onSettle: () => {
      settleCount++;
    },
  });

  // B's (the newer, currently-displayed contract's) fetch resolves FIRST.
  reqB.resolve("DATA_B");
  await runB;
  assert.equal(applied, "DATA_B", "newer generation's result should apply");
  assert.equal(settleCount, 1);

  // A's (the stale, already-abandoned contract's) fetch resolves SECOND — this is the exact
  // ordering that corrupted the drawer before the fix.
  reqA.resolve("DATA_A");
  await runA;

  assert.equal(
    applied,
    "DATA_B",
    "a late-arriving stale request must never overwrite the current generation's data"
  );
  // onSettle (e.g. clearing a loading flag) must also be skipped for the stale request — only
  // B's settle should have fired.
  assert.equal(settleCount, 1, "stale request's onSettle must not fire");
});

test("runGenerationGuardedLoad: a stale request's error must not overwrite the current generation's data either", async () => {
  let current = 0;
  const currentGeneration = () => current;

  const reqA = deferred<string>();
  const reqB = deferred<string>();
  let applied: string | null = null;

  current = 1;
  const runA = runGenerationGuardedLoad(1, currentGeneration, () => reqA.promise, {
    onStart: () => {},
    onSuccess: (d) => {
      applied = d;
    },
    onError: () => {
      applied = "ERROR_A";
    },
    onSettle: () => {},
  });

  current = 2;
  const runB = runGenerationGuardedLoad(2, currentGeneration, () => reqB.promise, {
    onStart: () => {},
    onSuccess: (d) => {
      applied = d;
    },
    onError: () => {
      applied = "ERROR_B";
    },
    onSettle: () => {},
  });

  reqB.resolve("DATA_B");
  await runB;
  assert.equal(applied, "DATA_B");

  // The abandoned, older request fails LATE — must not clobber B's good data with an error state.
  reqA.reject(new Error("stale network failure"));
  await runA;

  assert.equal(applied, "DATA_B", "a stale request's error must not surface over current data");
});

test("runGenerationGuardedLoad: the normal (non-raced) resolution order still applies cleanly", async () => {
  let current = 1;
  const currentGeneration = () => current;
  let applied: string | null = null;
  let settled = false;

  await runGenerationGuardedLoad(1, currentGeneration, async () => "DATA_A", {
    onStart: () => {},
    onSuccess: (d) => {
      applied = d;
    },
    onError: () => {
      applied = "ERROR";
    },
    onSettle: () => {
      settled = true;
    },
  });

  assert.equal(applied, "DATA_A");
  assert.equal(settled, true);
});
