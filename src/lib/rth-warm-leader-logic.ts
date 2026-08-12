import { isFlowIngestAlternateWriterSkip } from "@/lib/cron-writer-target-fresh";

/** Expected max gap (minutes) before we proactively re-warm during RTH. */
export const RTH_WRITER_HEAL_AFTER_MIN: Record<string, number> = {
  /** 20s — EventBridge heatmap-warm floors at 1/min; in-app leader fills the gap so Thermal
   *  SPY/QQQ don't sit on minute-old asof while SPX Slayer force-refreshes organically. */
  "heatmap-warm": 20 / 60,
  /** 20s — Vector walls cache TTL is ~900ms; EventBridge floors at 5/min and this cron was
   *  missing from the leader watch list (ops #2118: market_hours_stale during RTH). */
  "vector-walls-warm": 20 / 60,
  /** 10s — primary 5s writer is vector-bead-recorder-leader; HTTP cron is backup when leader stalls. */
  "vector-bead-record": 10 / 60,
  /** 1.5 = 90s — tighter than other warmers; desk cold-build blocks are the top UX pain point. */
  "desk-warm": 1.5,
  "uw-cache-refresh": 4,
  "zerodte-warm": 4,
  "flow-ingest": 4,
};

/** Pure overdue logic — exported for unit tests without pulling cron route handlers. */
export function rthWriterOverdue(
  key: string,
  lastRunAt: string | null,
  lastStatus: string | null,
  lastMessage: string | null,
  nowMs = Date.now()
): boolean {
  const healAfterMin = RTH_WRITER_HEAL_AFTER_MIN[key];
  if (healAfterMin == null) return false;
  if (!lastRunAt) return true;

  if (
    key === "flow-ingest" &&
    lastStatus === "skipped" &&
    isFlowIngestAlternateWriterSkip(lastMessage)
  ) {
    return false;
  }

  const ageMin = (nowMs - new Date(lastRunAt).getTime()) / 60_000;
  return Number.isFinite(ageMin) && ageMin > healAfterMin;
}
