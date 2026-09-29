import { NextRequest, NextResponse } from "next/server";
import { dbQuery, requireDatabaseInProduction } from "@/lib/db";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isAllowedCleanupTarget, cleanupRetentionDays } from "@/lib/db-cleanup-targets";
import { sumCleanupDeletes } from "@/lib/db-cleanup-sum";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";
import { runWithDeadlockRetry } from "@/lib/deadlock-retry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cross-invocation overlap guard. Root-caused 2026-09-12: this route deadlocked
 * (`deadlock detected`, Postgres 40P01) pruning `vector_wall_history` at 07:04:14 UTC, which made
 * it return HTTP 500 for that run — and this route's own BIE-ingest log line (one call per
 * request) was confirmed firing THREE times within ~4 minutes that night (07:04:23, 07:07:02,
 * 07:08:11 UTC), i.e. the SAME batched-DELETE loop, against the SAME ~26 tables, running
 * concurrently with itself. `hit-cron` (blackout-infra's EventBridge->Lambda fetch shim) throws on
 * any non-2xx response, and AWS's own retry-on-throw (Lambda async-retry vs. EventBridge
 * at-least-once delivery — not fully distinguishable from this repo) is the most likely source of
 * the 2nd/3rd invocation; a concurrent ECS deploy was ALSO rolling through at that exact minute
 * and is a plausible contributor to why the first attempt was slow/error-prone enough to trigger
 * whichever retry path fired. Concurrent invocations of the same batched-DELETE loop racing for
 * row locks across ~26 shared tables is an ordinary, sufficient way to deadlock on its own — no
 * exotic DDL-vs-DML theory required.
 *
 * This is deliberately NOT a fix to "why did AWS/hit-cron deliver >1 invocation" — that lives in
 * blackout-infra (the Lambda + EventBridge config), out of this repo's scope, and the exact
 * mechanism couldn't be pinned down from here. This guard makes a second/third concurrent
 * invocation a cheap no-op regardless of why it was delivered, the same `sharedCacheSetNx`
 * idempotent-skip pattern already used by vector-pick-sweep/banger-discovery/thermal-discord for
 * this exact problem shape — db-cleanup never had it because, being a nightly one-shot, a
 * same-instant double-fire looked unlikely until it actually happened.
 *
 * TTL: `db-cleanup`'s own `maxDuration` is 300s; 600s (2x) gives a slow-but-healthy run real
 * margin so its own lock can't expire out from under it mid-run — an expired lock would let a
 * genuine retry start a SECOND real run instead of skipping, recreating the exact deadlock this
 * guards against (see vector-pick-sweep/route.ts's own header for a fully-worked example of that
 * failure mode when a lock TTL is too tight against real observed runtime).
 */
const OVERLAP_LOCK_KEY = "db-cleanup:running";
const OVERLAP_LOCK_TTL_SEC = 600;

/**
 * Nightly DB cleanup — prunes high-volume tables to prevent unbounded growth.
 * Retention windows are conservative: analytics tables kept longer, telemetry pruned fast.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const acquired = await sharedCacheSetNx(
    OVERLAP_LOCK_KEY,
    { startedAt: started },
    OVERLAP_LOCK_TTL_SEC
  ).catch(() => true); // fail OPEN on a Redis error — a missed overlap guard is safer than a permanently stuck nightly prune
  if (!acquired) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "previous db-cleanup run still in flight (idempotent skip)",
    };
    await logCronRun("db-cleanup", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const { tables: pruneCounts, errors: pruneErrors } = await runCleanup();
    const totalDeleted = sumCleanupDeletes(pruneCounts);
    // BIE daily tick (best-effort, never fails the cleanup): ingest fresh platform
    // knowledge (docs/FINDINGS/latest edition — hash-deduped, embeds only when
    // VOYAGE_API_KEY is set) and persist the engine's self-evaluation report.
    const bie = await import("@/lib/bie/knowledge")
      .then((m) => m.ingestBieKnowledge())
      .catch(() => ({ stored: -1, skipped: [] as Array<{ source: string; reason: string }> }));
    const selfEval = await import("@/lib/bie/report")
      .then((m) => m.runBieDailySelfEval())
      .catch(() => null);
    const calibration = await import("@/lib/bie/calibration")
      .then((m) => m.runBieCalibration(14))
      .catch(() => null);
    const discovery = await import("@/lib/bie/discovery")
      .then((m) => m.runBieDiscovery())
      .catch(() => null);
    const tables: Record<string, unknown> = {
      ...pruneCounts,
      bie_knowledge_stored: bie.stored,
      // Surfaced, not just counted: `stored` alone cannot distinguish "ingested
      // everything" from "ingested what fit". The daily cron payload is where a
      // human or a monitor would actually notice a doc falling out of the corpus.
      bie_knowledge_skipped: bie.skipped.length,
      ...(bie.skipped.length > 0
        ? { bie_knowledge_skipped_docs: bie.skipped.map((s) => `${s.source} (${s.reason})`) }
        : {}),
      bie_self_eval: selfEval ? "ok" : "skipped",
      bie_calibration: calibration
        ? `${calibration.graded_plays} graded / ${calibration.recommendations.length} recs`
        : "skipped",
      bie_discovery: discovery
        ? `${discovery.patterns} call patterns analyzed`
        : "skipped",
    };
    const ok = pruneErrors.length === 0;
    const payload = {
      ok,
      total_deleted: totalDeleted,
      tables,
      ...(pruneErrors.length > 0 ? { errors: pruneErrors } : {}),
    };
    await logCronRun("db-cleanup", started, payload);
    return NextResponse.json(payload, { status: ok ? 200 : 500 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/db-cleanup]", error);
    await logCronRun("db-cleanup", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "DB cleanup failed" }, { status: 500 });
  } finally {
    await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined);
  }
}

// Fixed, code-literal status guards (NOT user input) so we never prune unresolved/open
// rows on outcome tables. Each value is a hardcoded SQL fragment.
const STATUS_GUARDS: Readonly<Record<string, string>> = {
  spx_play_outcomes: "outcome <> 'open'",
  nighthawk_play_outcomes: "outcome NOT IN ('pending', 'open')",
};

// Cap rows deleted per statement so cleanup never takes a long lock on a high-volume
// table. Each batch is its own short-lived statement/lock; the loop yields between batches.
const CLEANUP_BATCH_SIZE = 5000;
const CLEANUP_MAX_BATCHES = 10_000;

async function deleteOlderThan(table: string, column: string, days: number): Promise<number> {
  // Identifiers cannot be parameterized — validate against the allow-list and reject unknowns.
  if (!isAllowedCleanupTarget(table, column)) {
    throw new Error(`Refusing cleanup of unrecognized target: ${table}.${column}`);
  }
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`Invalid retention window (days must be a non-negative integer): ${days}`);
  }
  // Append a fixed status guard for outcome tables so open/pending rows are never pruned.
  const guard = STATUS_GUARDS[table] ? ` AND ${STATUS_GUARDS[table]}` : "";
  // Batched delete by ctid; window parameterized; rowCount on a plain DELETE is the affected count.
  let total = 0;
  try {
    for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
      // Deadlock (40P01) retry: root-caused 2026-09-12 on `vector_wall_history` — batched deletes
      // across ~26 tables can lock-order-race a concurrent writer (or, before the overlap guard
      // above, a second invocation of this very route). Postgres's own remedy for the losing side
      // of a deadlock is to retry the same statement, which is all this does; see
      // deadlock-retry.ts's header for why only 40P01 is retried (42P01 undefined_table is a
      // different, already-handled case below, and every other error still fails fast).
      const res = await runWithDeadlockRetry(
        () =>
          dbQuery(
            `DELETE FROM ${table}
               WHERE ctid IN (
                 SELECT ctid FROM ${table}
                 WHERE ${column} < NOW() - ($1::int || ' days')::interval${guard}
                 LIMIT $2
               )`,
            [days, CLEANUP_BATCH_SIZE]
          ),
        {
          onRetry: (attempt) =>
            console.warn(`[db-cleanup] ${table}: deadlock detected, retrying (attempt ${attempt})`),
        }
      );
      const deleted = res.rowCount ?? 0;
      total += deleted;
      if (deleted < CLEANUP_BATCH_SIZE) break;
    }
  } catch (err) {
    // A table whose writer hasn't run yet doesn't exist (Postgres 42P01 undefined_table). There's
    // nothing to prune, and one not-yet-created table must NOT fail the whole nightly cleanup
    // (this was failing the run: 'relation "spx_signal_weight_reports" does not exist'). Skip it;
    // it self-heals once the writer creates the table. Re-throw anything else.
    if ((err as { code?: string } | null)?.code === "42P01") {
      console.warn(`[db-cleanup] skipping ${table}: table does not exist yet (no rows to prune)`);
      return 0;
    }
    throw err;
  }
  return total;
}

type CleanupRunResult = {
  tables: Record<string, number>;
  errors: { table: string; error: string }[];
};

async function runCleanup(): Promise<CleanupRunResult> {
  // Generous, env-configurable retention for high-write outcome tables. Default 365d keeps a
  // full year of resolved history for admin rollups / Largo analytics; hard floor is 90d.
  const spxOutcomeDays = cleanupRetentionDays(process.env.SPX_OUTCOMES_RETENTION_DAYS, 365);
  const nighthawkOutcomeDays = cleanupRetentionDays(
    process.env.NIGHTHAWK_OUTCOMES_RETENTION_DAYS,
    365,
  );

  const tasks: { key: string; run: () => Promise<number> }[] = [
    { key: "api_telemetry_events", run: () => deleteOlderThan("api_telemetry_events", "at", 7) },
    // Night Hawk avg-premium scorer uses 30-day rolling window — hard floor.
    { key: "flow_alerts", run: () => deleteOlderThan("flow_alerts", "inserted_at", 30) },
    { key: "cron_job_runs", run: () => deleteOlderThan("cron_job_runs", "started_at", 7) },
    { key: "spx_signal_log", run: () => deleteOlderThan("spx_signal_log", "created_at", 14) },
    {
      key: "nighthawk_dossiers_staging",
      run: () => deleteOlderThan("nighthawk_dossiers_staging", "created_at", 2),
    },
    { key: "nighthawk_job_log", run: () => deleteOlderThan("nighthawk_job_log", "created_at", 14) },
    { key: "admin_audit_log", run: () => deleteOlderThan("admin_audit_log", "created_at", 90) },
    {
      key: "spx_play_outcomes",
      run: () => deleteOlderThan("spx_play_outcomes", "closed_at", spxOutcomeDays),
    },
    {
      key: "nighthawk_play_outcomes",
      run: () => deleteOlderThan("nighthawk_play_outcomes", "created_at", nighthawkOutcomeDays),
    },
    {
      key: "spx_signal_observations",
      run: () => deleteOlderThan("spx_signal_observations", "observed_at", 30),
    },
    {
      key: "spx_signal_weight_reports",
      run: () => deleteOlderThan("spx_signal_weight_reports", "computed_at", 365),
    },
    { key: "market_regime", run: () => deleteOlderThan("market_regime", "captured_at", 7) },
    { key: "flow_anomalies", run: () => deleteOlderThan("flow_anomalies", "detected_at", 14) },
    { key: "coaching_alerts", run: () => deleteOlderThan("coaching_alerts", "generated_at", 14) },
    {
      key: "spx_confluence_shadow_observations",
      run: () => deleteOlderThan("spx_confluence_shadow_observations", "observed_at", 30),
    },
    {
      key: "spx_engine_snapshots",
      run: () => deleteOlderThan("spx_engine_snapshots", "observed_at", 14),
    },
    {
      key: "spx_playbook_shadow_observations",
      run: () => deleteOlderThan("spx_playbook_shadow_observations", "observed_at", 30),
    },
    {
      key: "spx_playbook_instance_events",
      run: () => deleteOlderThan("spx_playbook_instance_events", "observed_at", 30),
    },
    {
      key: "spx_playbook_instances",
      run: () => deleteOlderThan("spx_playbook_instances", "updated_at", 90),
    },
    { key: "lotto_plays", run: () => deleteOlderThan("lotto_plays", "created_at", 365) },
    {
      key: "vector_wall_history",
      run: () => deleteOlderThan("vector_wall_history", "updated_at", 14),
    },
    // Previously unbounded tables — now covered.
    {
      key: "gex_regime_events",
      run: () => deleteOlderThan("gex_regime_events", "observed_at", 30),
    },
    {
      key: "nighthawk_jobs",
      run: () => deleteOlderThan("nighthawk_jobs", "started_at", 90),
    },
    {
      key: "nighthawk_editions",
      run: () => deleteOlderThan("nighthawk_editions", "created_at", 365),
    },
    {
      key: "bie_interactions",
      run: () => deleteOlderThan("bie_interactions", "created_at", 90),
    },
  ];

  // allSettled: one table's transient timeout must not abort the rest of the nightly prune.
  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const tables: Record<string, number> = {};
  const errors: { table: string; error: string }[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const { key } = tasks[i];
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      tables[key] = outcome.value;
      continue;
    }
    tables[key] = 0;
    const error =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    errors.push({ table: key, error });
    console.error(`[db-cleanup] ${key} prune failed:`, error);
  }

  return { tables, errors };
}
