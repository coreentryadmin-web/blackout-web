/**
 * Sweep sharding — split the shared universe across worker replicas.
 *
 * The recorder was a single Redis-elected leader doing all ~122 tickers alone. Measured on prod
 * 2026-08-12: one market-worker task pegged at 100% CPU for 40 straight minutes while its peer sat
 * at 0.1% — half the provisioned compute idle while the sweep ran 6x over its 5s budget.
 *
 * Kept in its OWN module rather than appended to vector-bead-recorder-logic.ts so this lands
 * without touching a file another in-flight PR is also extending.
 */

// ── Sweep sharding across worker replicas ─────────────────────────────────────────────────────

/**
 * How many shards the universe is split into. Fixed, NOT derived from the live replica count:
 * a modulus that changes as tasks come and go would reassign every ticker on each membership
 * blip, so a name's rail would jump between workers mid-session for no reason.
 */
export const VECTOR_BEAD_SHARD_COUNT = 4;

/**
 * Stable shard for a ticker. FNV-1a rather than an index into the universe array, because the
 * shared universe is `static ∪ dynamic` and its ORDER changes whenever a member opens a new
 * symbol — an index-based split would silently reshuffle every ticker's owner on an unrelated
 * event. Hashing the symbol keeps a ticker on one shard for as long as its name is its name.
 */
export function beadShardForTicker(ticker: string, shardCount = VECTOR_BEAD_SHARD_COUNT): number {
  const n = Math.max(1, Math.floor(shardCount) || 1);
  let h = 0x811c9dc5;
  const s = String(ticker ?? "").toUpperCase();
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % n;
}

/**
 * Which shards THIS replica is responsible for this tick.
 *
 * `heldSlots` is every slot index currently claimed across the cluster (including our own);
 * `mySlot` is ours. The rule:
 *
 *  - we always own our own slot, and
 *  - the LOWEST-indexed live replica additionally adopts every ORPHANED shard — one whose slot
 *    no replica currently holds.
 *
 * Orphan adoption is the part that matters. Without it, losing a task silently stops recording
 * a quarter of the universe: no error, no failed ticker, just a set of rails that quietly stop
 * growing — the exact signature this whole investigation started from, and the reason a naive
 * `hash % replicas` split is worse than not sharding at all. Coverage is preserved whenever at
 * least ONE replica is alive; the cost is that the lowest replica carries extra load while a
 * peer is down, which is strictly better than a hole in the data.
 *
 * Restricting adoption to the lowest slot (rather than letting everyone adopt) bounds duplicate
 * work. A duplicate is harmless — both writers stamp the same bucket with the same reading — but
 * it is wasted CPU on the machine that is already the bottleneck.
 *
 * Returns [] when we hold no slot: a replica that lost its claim must do nothing rather than
 * guess, or two tasks end up believing they own the same shard.
 */
export function beadShardsForReplica(
  mySlot: number | null,
  heldSlots: readonly number[],
  shardCount = VECTOR_BEAD_SHARD_COUNT
): number[] {
  const n = Math.max(1, Math.floor(shardCount) || 1);
  if (mySlot == null || !Number.isInteger(mySlot) || mySlot < 0 || mySlot >= n) return [];
  const held = new Set(heldSlots.filter((s) => Number.isInteger(s) && s >= 0 && s < n));
  held.add(mySlot); // our own claim is authoritative even if the read raced
  const mine = [mySlot];
  const isLowest = Math.min(...held) === mySlot;
  if (isLowest) {
    for (let s = 0; s < n; s += 1) if (!held.has(s)) mine.push(s);
  }
  return mine.sort((a, b) => a - b);
}

/** The slice of the universe this replica records this tick. */
export function partitionUniverseForReplica(
  tickers: readonly string[],
  shards: readonly number[],
  shardCount = VECTOR_BEAD_SHARD_COUNT
): string[] {
  if (shards.length === 0) return [];
  const own = new Set(shards);
  return tickers.filter((t) => own.has(beadShardForTicker(t, shardCount)));
}
