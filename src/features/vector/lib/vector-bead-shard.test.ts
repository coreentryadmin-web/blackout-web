import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VECTOR_BEAD_SHARD_COUNT,
  beadShardForTicker,
  beadShardsForReplica,
  partitionUniverseForReplica,
} from "./vector-bead-shard";

const UNIVERSE = [
  "SPX", "SPY", "QQQ", "IWM", "NVDA", "TSLA", "AAPL", "AMD", "META", "AMZN",
  "GOOGL", "MSFT", "GOOG", "NFLX", "NDX", "DIA", "GLD", "TLT", "COIN", "MSTR",
  "SMH", "ASTS", "PLTR", "MU", "OKLO", "BX", "SOUN", "IBIT", "DELL", "ANET",
];

test("beadShardForTicker: a ticker's shard does not move when the universe reorders", () => {
  // The shared universe is `static ∪ dynamic` and its ORDER changes whenever a member opens a new
  // symbol. An index-based split would silently reassign every ticker's owner on that unrelated
  // event, so ownership must come from the SYMBOL, not its position.
  const before = UNIVERSE.map((t) => beadShardForTicker(t));
  const reordered = [...UNIVERSE].reverse();
  for (const t of reordered) {
    assert.equal(beadShardForTicker(t), before[UNIVERSE.indexOf(t)], `${t} changed shard`);
  }
});

test("beadShardForTicker: shards are in range and reasonably balanced", () => {
  const counts = new Array(VECTOR_BEAD_SHARD_COUNT).fill(0);
  for (const t of UNIVERSE) {
    const s = beadShardForTicker(t);
    assert.ok(s >= 0 && s < VECTOR_BEAD_SHARD_COUNT, `${t} -> ${s} out of range`);
    counts[s] += 1;
  }
  // Not asking for perfection — asking that no shard is empty and none carries the whole load,
  // because either would mean a replica idles while another is the bottleneck all over again.
  for (const c of counts) {
    assert.ok(c > 0, `a shard got nothing: ${JSON.stringify(counts)}`);
    assert.ok(c < UNIVERSE.length * 0.6, `a shard got most of the universe: ${JSON.stringify(counts)}`);
  }
});

test("every ticker is owned by EXACTLY one replica when all slots are held", () => {
  const held = [0, 1, 2, 3];
  const seen = new Map<string, number>();
  for (const slot of held) {
    for (const t of partitionUniverseForReplica(UNIVERSE, beadShardsForReplica(slot, held))) {
      assert.equal(seen.has(t), false, `${t} claimed by two replicas`);
      seen.set(t, slot);
    }
  }
  assert.equal(seen.size, UNIVERSE.length, "every ticker must be swept by someone");
});

test("COVERAGE SURVIVES a lost replica — the lowest live slot adopts the orphans", () => {
  // This is the whole reason the split is not a naive `hash % replicas`. If a task dies and its
  // shard simply stops being swept, a quarter of the universe silently stops recording: no error,
  // no failed ticker, just rails that quietly stop growing. That is the exact signature of the bug
  // this work started from, and it must not be reintroduced as the fix for it.
  const held = [0, 2]; // slots 1 and 3 died
  const covered = new Set<string>();
  for (const slot of held) {
    for (const t of partitionUniverseForReplica(UNIVERSE, beadShardsForReplica(slot, held))) {
      covered.add(t);
    }
  }
  assert.equal(covered.size, UNIVERSE.length, "orphaned shards must still be recorded");
});

test("a SINGLE surviving replica covers the entire universe", () => {
  const only = partitionUniverseForReplica(UNIVERSE, beadShardsForReplica(0, [0]));
  assert.deepEqual(new Set(only), new Set(UNIVERSE));
});

test("only the LOWEST live slot adopts orphans — duplicate work is bounded", () => {
  // A duplicate is harmless (both writers stamp the same bucket with the same reading) but it is
  // wasted CPU on the machine that is already the bottleneck, which is what we are fixing.
  const held = [1, 2];
  assert.deepEqual(beadShardsForReplica(1, held), [0, 1, 3], "lowest slot takes its own + orphans");
  assert.deepEqual(beadShardsForReplica(2, held), [2], "higher slot takes only its own");
});

test("a replica holding NO slot records nothing rather than guessing", () => {
  // Guessing is how two tasks end up believing they own the same shard.
  assert.deepEqual(beadShardsForReplica(null, [0, 1]), []);
  assert.deepEqual(partitionUniverseForReplica(UNIVERSE, []), []);
});

test("out-of-range or junk slot indices never claim work", () => {
  assert.deepEqual(beadShardsForReplica(-1, [0]), []);
  assert.deepEqual(beadShardsForReplica(VECTOR_BEAD_SHARD_COUNT, [0]), []);
  assert.deepEqual(beadShardsForReplica(1.5, [0]), []);
});

test("our own slot is authoritative even if the held-slots read raced", () => {
  // readHeldSlots can return a stale view (a peer's SETNX landing between our claim and our read).
  // Dropping our own slot because it was missing from that snapshot would make us sweep nothing.
  assert.deepEqual(beadShardsForReplica(2, []), [0, 1, 2, 3], "sole known replica adopts all");
  assert.ok(beadShardsForReplica(3, [0, 1]).includes(3), "our slot is always ours");
});
