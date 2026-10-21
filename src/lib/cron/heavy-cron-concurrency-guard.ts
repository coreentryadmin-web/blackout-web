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
const RESERVED_SLOT_KEY_PREFIX = "cron:heavy-slot:reserved:";

/** How many heavy crons may run at once, cluster-wide. Six crons contending for 1-2 ECS web
 *  tasks is the measured problem; capping concurrent heavy work at 2 leaves one slot for a
 *  shorter job to still make progress while a long one (vector-pick-sweep) is mid-run, rather
 *  than serializing everything behind a single lock and multiplying worst-case staleness. */
export const MAX_CONCURRENT_HEAVY_CRONS = 2;

/**
 * Crons that get their OWN dedicated slot instead of contending with the shared numbered pool
 * above. Added 2026-10-14 for `swing-active-refresh` after it was found chronically starved
 * behind the other five crons here — each of which can legitimately hold a shared slot for
 * minutes (vector-pick-sweep measured up to ~900s) while swing-active-refresh's own measured
 * elapsed= runtime across 18 real runs (2026-10-13, 24h window) was 4-66s, never once close to
 * the others' durations. Competing for the same 2 keys meant a slow cron routinely occupied both
 * slots across swing-active-refresh's entire 15-minute cadence: live cron-health showed a 54.5%
 * skip rate (24 of 44 fires in 24h), and because this cron is the ONLY writer of live option
 * marks for open swing positions, the result was a real, severe member-facing bug — Ask Largo's
 * own swing play-briefs (`/api/market/swing/play-brief`) showed SIGN-INVERTED, ~19.5h-stale P&L
 * for the desk's native swing positions (INTC/GOOG/GOOGL: brief said +15.3%/+6.6%/+8.7%, the
 * live marks feed said -20.63%/-0.27%/-0.24% for the same instant) — confirmed via CloudWatch
 * (last successful background-done log 2026-10-13 20:01 UTC, nothing since despite 16 on-schedule
 * fires), EventBridge (rule enabled, firing on schedule), and `GET /api/admin/cron-health`
 * (`last_message: "heavy-cron concurrency slot unavailable (idempotent skip)"`).
 *
 * A dedicated slot bounds total concurrent heavy work to AT MOST 3 (2 shared + this 1) rather
 * than the original uncapped 6 this guard was built against — still a real, bounded mitigation of
 * the ALB-tail-latency problem, while no longer forcing a cheap, correctness-critical cron to wait
 * behind ones that can occupy a slot an order of magnitude longer. It keeps its own self-overlap
 * semantics (the shared logic below already serializes a cron against itself via the same atomic
 * SET NX primitive) — this does not change how many swing-active-refresh runs can be in flight at
 * once, only who it has to wait on.
 *
 * `zerodte-warm` joined the reserved set 2026-10-21: when both shared slots were held by
 * vector-family crons (multi-minute runs), zerodte-warm logged
 * "heavy-cron concurrency slot unavailable" while its fast handshake still looked healthy —
 * `zerodte_scan_heartbeat` went `critical_stale` (>10m without `recordZeroDteScanTick`) and
 * `cron-audit-query` / `cron-staleness-watchdog` correctly failed CI with `problems: zerodte-warm`.
 * Same starvation shape as swing-active-refresh, different member surface (0DTE board / discovery).
 */
const RESERVED_SLOT_CRONS = new Set<string>(["swing-active-refresh", "zerodte-warm"]);

export function reservedHeavyCronSlotKey(cronName: string): string {
  return `${RESERVED_SLOT_KEY_PREFIX}${cronName}`;
}

/** Break a wedged reserved slot (e.g. deploy recycled the task before slot.release()). */
export async function forceReleaseReservedHeavyCronSlot(cronName: string): Promise<void> {
  if (!RESERVED_SLOT_CRONS.has(cronName)) return;
  await sharedCacheDel(reservedHeavyCronSlotKey(cronName)).catch(() => undefined);
}

export type HeavyCronSlot = { readonly cronName: string; release(): Promise<void> };

function slotHandle(cronName: string, key: string): HeavyCronSlot {
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

/**
 * Try to claim a heavy-cron slot. A name in `RESERVED_SLOT_CRONS` gets its own dedicated key,
 * independent of the shared numbered pool, so it never contends with (or counts against) the
 * other crons' slots. Every other cron name claims one of the fixed shared-pool slots as before.
 * Returns `null` when the relevant slot(s) are already held — the caller should skip this run
 * (same shape as its own pre-existing self-overlap guard).
 *
 * Fail-open per slot attempt on a Redis error, matching every sibling overlap guard in this repo
 * (`.catch(() => true)`): a missed concurrency guard is safer than a cron that silently stops
 * running because Redis is unreachable.
 */
export async function acquireHeavyCronSlot(
  cronName: string,
  ttlSec: number
): Promise<HeavyCronSlot | null> {
  if (RESERVED_SLOT_CRONS.has(cronName)) {
    const key = `${RESERVED_SLOT_KEY_PREFIX}${cronName}`;
    const acquired = await sharedCacheSetNx(key, { cronName, startedAt: Date.now() }, ttlSec).catch(
      () => true
    );
    return acquired ? slotHandle(cronName, key) : null;
  }
  for (let slot = 1; slot <= MAX_CONCURRENT_HEAVY_CRONS; slot++) {
    const key = `${SLOT_KEY_PREFIX}${slot}`;
    const acquired = await sharedCacheSetNx(key, { cronName, startedAt: Date.now() }, ttlSec).catch(
      () => true
    );
    if (acquired) return slotHandle(cronName, key);
  }
  return null;
}
