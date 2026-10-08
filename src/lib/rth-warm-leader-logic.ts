import { isFlowIngestAlternateWriterSkip } from "@/lib/cron-writer-target-fresh";

/** Expected max gap (minutes) before we proactively re-warm during RTH. */
export const RTH_WRITER_HEAL_AFTER_MIN: Record<string, number> = {
  /** 81s (p90 measured runtime) — was 20s, which was nonsensical relative to this specific job's
   *  own real cost: a full warm sweeps the shared ~100-ticker universe through Polygon and
   *  historically runs p50=46.5s/p90=81.1s/p99=181.1s/max=209.2s (measured 2026-09-03, in this
   *  file's own route — see heatmap-warm/route.ts's OVERLAP_LOCK comment), reconfirmed live
   *  2026-10-08 (70 consecutive runs, median 60.9s, max 109.4s). `fetchCronJobLastRuns()`'s
   *  `started_at` is a DB-default `now()` stamped when `logCronRun` INSERTs at the very end of
   *  the handler — i.e. it is actually the run's COMPLETION time, not its start — so with the old
   *  20s threshold, every run was already "overdue" by the instant it finished (its own runtime
   *  alone exceeds 20s almost every time), and the very next 15s leader tick (TICK_MS,
   *  rth-warm-leader.ts) re-commissioned a fresh full sweep. Measured live 2026-10-08 08:00-09:46
   *  UTC (the pre-EventBridge 4-7am ET window — EventBridge's OWN schedule doesn't start until
   *  11:00 UTC/7am ET, confirmed via `AWS/Events` `Invocations`=0 for this rule in that window, so
   *  this cron ran ENTIRELY off this leader): zero overlap-lock skips, ~68-70% wall-clock duty
   *  cycle, median gap between completions and the next start only ~30s — a "backup" running as
   *  the de facto PRIMARY, near-continuously. Raising to the job's own p90 runtime fixes the
   *  "overdue instantly on completion" mismatch (same backup-cadence-matches-job-cost design
   *  every other entry in this map already uses) with no RTH freshness cost: once EventBridge is
   *  live (11:00-21:59 UTC) its OWN independent ~1/min schedule — not this threshold — governs
   *  cadence whenever EventBridge is healthy; this constant only throttles needless churn during
   *  the pre-EventBridge pre-market hours and gives the leader honest "only act on a real stall"
   *  backup semantics the rest of this file already follows. See
   *  docs/audit/findings-staging/2026-10-08-heatmap-warm-heal-threshold-duty-cycle.md. */
  "heatmap-warm": 81 / 60,
  /** 20s — Vector walls cache TTL is ~900ms; EventBridge floors at 5/min and this cron was
   *  missing from the leader watch list (ops #2118: market_hours_stale during RTH). */
  "vector-walls-warm": 20 / 60,
  /** 10s — primary 5s writer is vector-bead-recorder-leader; HTTP cron is backup when leader stalls. */
  "vector-bead-record": 10 / 60,
  /** 4 min — ~2 min RTH schedule; EventBridge not yet synced (#3066). In-app leader backup. */
  "vector-pick-sweep": 4,
  /** 5 min — Meridian timeline + SPX GEX + desk enrichment; was missing from EventBridge
   *  (ops #2351: market_hours_stale during RTH). */
  "meridian-warm": 5,
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
