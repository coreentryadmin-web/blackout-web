import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// REGRESSION (round 112, sibling of round 111's x-rate-budget-concurrency.test.ts):
// markTweetReplied used to do an UNLOCKED read-modify-write (getRepliedTweetIds -> mutate ->
// writeMeta) against the shared `x_marketing_replied_ids` Postgres row. Two concurrent
// callers — `x-growth` and `x-engage` are separate cron routes that both call the SAME
// runEngagementSweep (which calls markTweetReplied on quote/reply), and `x-replies`
// (x-mention-replies.ts) writes the same row too — can interleave: both read the same base
// set before either writes, so the second write clobbers the first and one tweet id is lost
// ("lost update"). Unlike the budget-counter race, losing an id here means a LATER run no
// longer sees that tweet as already-replied-to and can reply/quote-tweet it AGAIN — a
// visible, public duplicate action from the brand account.
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
        // Force a real async gap so two concurrent markTweetReplied calls both read BEFORE
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

describe("x-marketing-meta concurrency (markTweetReplied)", () => {
  it("two concurrent marks for DIFFERENT tweet ids both land (no lost update)", async () => {
    const { markTweetReplied, getRepliedTweetIds } = await loadModule();
    store = new Map();
    lockHolder = null;

    // x-growth (quote-tweeting tweet A) and x-engage (replying to tweet B) racing the same
    // underlying REPLIED_KEY row at the same tick.
    await Promise.all([
      markTweetReplied("tweet-A"),
      markTweetReplied("tweet-B"),
    ]);

    const ids = await getRepliedTweetIds();
    assert.ok(
      ids.has("tweet-A") && ids.has("tweet-B"),
      "both concurrent markTweetReplied calls must be reflected — a lost update would drop one",
    );
  });

  it("many concurrent marks for different tweet ids all land", async () => {
    const { markTweetReplied, getRepliedTweetIds } = await loadModule();
    store = new Map();
    lockHolder = null;

    const N = 8;
    const tweetIds = Array.from({ length: N }, (_, i) => `tweet-${i}`);
    await Promise.all(tweetIds.map((id) => markTweetReplied(id)));

    const ids = await getRepliedTweetIds();
    for (const id of tweetIds) {
      assert.ok(ids.has(id), `expected ${id} to be recorded — lost updates would drop some`);
    }
    assert.equal(ids.size, N, `expected all ${N} ids to land, lost updates would undercount`);
  });

  it("a mark racing against a concurrent re-mark of the SAME tweet id is still recorded", async () => {
    const { markTweetReplied, getRepliedTweetIds } = await loadModule();
    store = new Map();
    lockHolder = null;

    await Promise.all([
      markTweetReplied("tweet-dup"),
      markTweetReplied("tweet-dup"),
      markTweetReplied("tweet-other"),
    ]);

    const ids = await getRepliedTweetIds();
    assert.ok(ids.has("tweet-dup"));
    assert.ok(ids.has("tweet-other"));
  });
});
