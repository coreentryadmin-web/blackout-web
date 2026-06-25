import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runWithUwHuntBudget,
  tryClaimHuntUwCall,
  huntUwBudgetSnapshot,
  inHuntUwBudget,
  isUwHuntBudgetError,
  UwHuntBudgetExhaustedError,
} from "./uw-hunt-budget";

// Behavioral spec for the Night Hawk hunt live-UW budget gate. This is the cache-reader-rule
// enforcement that stops a hunt from draining the shared 2-RPS UW limiter / tripping the
// breaker for the live SPX desk. The gate is enforced inside throttleUw via tryClaimHuntUwCall.

test("outside a hunt context the gate is inert — every claim is allowed", () => {
  assert.equal(inHuntUwBudget(), false);
  assert.equal(huntUwBudgetSnapshot(), null);
  for (let i = 0; i < 1000; i++) assert.equal(tryClaimHuntUwCall(), true);
});

test("inside a hunt, exactly N live claims succeed then the budget denies", async () => {
  await runWithUwHuntBudget(
    async () => {
      assert.equal(inHuntUwBudget(), true);
      // 3 granted → 3 allowed, then denied.
      assert.equal(tryClaimHuntUwCall(), true);
      assert.equal(tryClaimHuntUwCall(), true);
      assert.equal(tryClaimHuntUwCall(), true);
      assert.equal(tryClaimHuntUwCall(), false);
      assert.equal(tryClaimHuntUwCall(), false);

      const snap = huntUwBudgetSnapshot();
      assert.ok(snap);
      assert.equal(snap.granted, 3);
      assert.equal(snap.remaining, 0);
      assert.equal(snap.denied, 2);
    },
    { maxLiveUwCalls: 3 }
  );
});

test("a zero budget denies the very first live call (full cache-read only)", async () => {
  await runWithUwHuntBudget(
    async () => {
      assert.equal(tryClaimHuntUwCall(), false);
      assert.equal(huntUwBudgetSnapshot()?.denied, 1);
    },
    { maxLiveUwCalls: 0 }
  );
});

test("budget survives across awaits / async fan-out (AsyncLocalStorage propagation)", async () => {
  await runWithUwHuntBudget(
    async () => {
      // Simulate the dossier batch fanning out concurrent fetches that each claim a slot.
      const results = await Promise.all(
        Array.from({ length: 6 }, async (_v, i) => {
          await new Promise((r) => setTimeout(r, i % 2));
          return tryClaimHuntUwCall();
        })
      );
      const allowed = results.filter(Boolean).length;
      // Exactly the granted budget is consumed regardless of interleaving.
      assert.equal(allowed, 4);
      assert.equal(huntUwBudgetSnapshot()?.remaining, 0);
    },
    { maxLiveUwCalls: 4 }
  );
});

test("two concurrent hunts get INDEPENDENT budgets (no cross-contamination)", async () => {
  let aRemaining = -1;
  let bRemaining = -1;
  await Promise.all([
    runWithUwHuntBudget(
      async () => {
        tryClaimHuntUwCall();
        await new Promise((r) => setTimeout(r, 2));
        tryClaimHuntUwCall();
        aRemaining = huntUwBudgetSnapshot()?.remaining ?? -1;
      },
      { maxLiveUwCalls: 5 }
    ),
    runWithUwHuntBudget(
      async () => {
        tryClaimHuntUwCall();
        await new Promise((r) => setTimeout(r, 1));
        bRemaining = huntUwBudgetSnapshot()?.remaining ?? -1;
      },
      { maxLiveUwCalls: 5 }
    ),
  ]);
  assert.equal(aRemaining, 3); // 5 - 2
  assert.equal(bRemaining, 4); // 5 - 1
});

test("nested runWithUwHuntBudget reuses the OUTER budget — cap stays per-hunt", async () => {
  await runWithUwHuntBudget(
    async () => {
      tryClaimHuntUwCall(); // outer spends 1 → 1 left
      await runWithUwHuntBudget(
        async () => {
          // inner must NOT mint a fresh budget; it shares the outer's remaining.
          assert.equal(tryClaimHuntUwCall(), true); // spends the last one
          assert.equal(tryClaimHuntUwCall(), false); // outer budget exhausted
        },
        { maxLiveUwCalls: 99 } // ignored — outer context wins
      );
      assert.equal(huntUwBudgetSnapshot()?.remaining, 0);
    },
    { maxLiveUwCalls: 2 }
  );
});

test("the exhaustion sentinel is recognizable and is NOT a 429 (must not feed the breaker)", () => {
  const err = new UwHuntBudgetExhaustedError();
  assert.equal(isUwHuntBudgetError(err), true);
  assert.equal(isUwHuntBudgetError(new Error("plain")), false);
  assert.equal(isUwHuntBudgetError({ code: "UW_HUNT_BUDGET_EXHAUSTED" }), true);
  // Critically: the message must contain no "429" / 5xx token so uwGetSafe's catch
  // routes it to a graceful null (cached/last-known), never noteUw429.
  assert.equal(/429|50[234]/.test(err.message), false);
});

test("budget context does not leak after runWithUwHuntBudget resolves", async () => {
  await runWithUwHuntBudget(async () => tryClaimHuntUwCall(), { maxLiveUwCalls: 1 });
  assert.equal(inHuntUwBudget(), false);
  assert.equal(tryClaimHuntUwCall(), true); // back to inert outside the hunt
});
