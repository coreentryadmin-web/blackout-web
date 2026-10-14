import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";

/**
 * Cross-CRON concurrency guard — distinct from the per-cron `sharedCacheSetNx` overlap locks
 * already on vector-pick-sweep/vector-dark-pool-warm/zerodte-warm/vector-full-state-snapshot/
 * bie-full-state-snapshot/swing-active-refresh. Those locks each correctly stop a cron from
 * overlapping with ITSELF (a second scheduled fire landing while the first is still in flight)
 * but do nothing about DIFFERENT crons overlapping with EACH OTHER — and live CloudWatch Logs
 * (2026-10-13, 13:35-13:56 UTC RTH window) show exactly that: all six of the crons above
 * in flight SIMULTANEOUSLY on the shared ECS web-tier task(s) that also serve live member
 * HTTP requests, several badly overrunning their own schedule interval —
 * `vector-pick-sweep` elapsed=476169ms (7.9min) and 260276ms back-to-back,
 * `vector-dark-pool-warm` elapsed=183089ms, `zerodte-warm` elapsed=148879ms/117393ms,
 * `vector-full-state-snapshot` elapsed=143272ms/112411ms, `bie-full-state-snapshot`
 * elapsed=78415ms/77570ms, all inside one 21-minute window — 1:1 time-correlated with the
 * already-open ALB `TargetResponseTime` tail-latency finding (Max 60-120s sustained across the
 * same RTH session, `docs/audit/FINDINGS.md`'s standing P1 since 2026-09-02). Each of these
 * crons dispatches its heavy body via Next's `after()`, which runs in the SAME process/event
 * loop that handles live member requests — six of them compounding at once is a materially
 * different load shape than any one of them alone, which is what every existing per-cron guard
 * was built to bound.
 *
 * This guard caps how many of the registered "heavy" crons may have their body actively running
 * at once, cluster-wide, via a small fixed pool of numbered Redis slots (same atomic
 * `SET key val EX ttl NX` primitive every sibling overlap lock already uses — never a
 * read-then-write race). A cron that cannot claim a slot skips this run with the same
 * idempotent-skip semantics its own self-overlap guard already uses and is picked up on its next
 * scheduled fire, a few minutes later — never queued or blocked in-process.
 */
const SLOT_KEY_PREFIX = "cron:heavy-slot:";

/** How many heavy crons may run at once, cluster-wide. Six crons contending for 1-2 ECS web
 *  tasks is the measured problem; capping concurrent heavy work at 2 leaves one slot for a
 *  shorter job to still make progress while a long one (vector-pick-sweep) is mid-run, rather
 *  than serializing everything behind a single lock and multiplying worst-case staleness. */
export const MAX_CONCURRENT_HEAVY_CRONS = 2;

export type HeavyCronSlot = { readonly cronName: string; release(): Promise<void> };

/**
 * Try to claim one of the fixed heavy-cron slots. Returns `null` when every slot is already held
 * — the caller should skip this run (same shape as its own pre-existing self-overlap guard).
 *
 * Fail-open per slot attempt on a Redis error, matching every sibling overlap guard in this repo
 * (`.catch(() => true)`): a missed concurrency guard is safer than a cron that silently stops
 * running because Redis is unreachable.
 */
export async function acquireHeavyCronSlot(
  cronName: string,
  ttlSec: number
): Promise<HeavyCronSlot | null> {
  for (let slot = 1; slot <= MAX_CONCURRENT_HEAVY_CRONS; slot++) {
    const key = `${SLOT_KEY_PREFIX}${slot}`;
    const acquired = await sharedCacheSetNx(key, { cronName, startedAt: Date.now() }, ttlSec).catch(
      () => true
    );
    if (acquired) {
      let released = false;
      return {
        cronName,
        release: async () => {
          if (released) return;
          released = true;
          await sharedCacheDel(key).catch(() => undefined);
        },
      };
    }
  }
  return null;
}
