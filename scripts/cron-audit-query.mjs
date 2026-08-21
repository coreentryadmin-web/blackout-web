#!/usr/bin/env node
/**
 * Prod audit: latest cron_job_runs per registered job + zero-run detection.
 * Env: DATABASE_PUBLIC_URL or DATABASE_URL (optional when AWS creds + CRON_SECRET available)
 *
 * Usage: npm run validate:cron
 */
import { ALL_CRON_KEYS } from "./railway-cron-services.mjs";
import {
  createAuditClient,
  resolveAuditDbUrl,
  isPrivateVpcDbUrl,
  describeConnectError,
} from "./pg-audit.mjs";
import { auditSecret } from "./audit/lib/prod-secrets.mjs";
import { isXMarketingCronSuppressed } from "./audit/lib/x-marketing-paused.mjs";

const JOB_KEYS = [...ALL_CRON_KEYS];
const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");

/** Registered in code + TOML but cron trigger service not yet provisioned — warn, don't fail CI. */
const PROVISION_PENDING = new Set([]);

async function auditViaWatchdog() {
  const cron = auditSecret("CRON_SECRET");
  if (!cron) {
    console.error("[cron-audit] CRON_SECRET not set — cannot run HTTP watchdog fallback");
    process.exit(1);
  }
  const res = await fetch(`${BASE}/api/cron/cron-staleness-watchdog`, {
    headers: { Authorization: `Bearer ${cron}` },
    signal: AbortSignal.timeout(90_000),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200) {
    console.error(`[cron-audit] watchdog HTTP ${res.status}`);
    process.exit(1);
  }
  const problems = [...(body.problem_keys ?? []), ...(body.rth_stale_keys ?? [])].filter(
    (key) => !isXMarketingCronSuppressed(key)
  );
  console.log("\n=== CRON AUDIT (HTTP watchdog fallback) ===\n");
  console.log(`checked: ${body.checked ?? "?"}`);
  console.log(`problems: ${problems.length ? problems.join(", ") : "(none)"}`);
  console.log(`error_spike: ${body.error_spike ?? "none"} (${body.error_count ?? 0} in ${body.error_window_min ?? "?"}m)`);
  if (body.error_spike === "critical" || problems.length > 0) {
    process.exit(1);
  }
  console.log("\nGREEN — cron watchdog reports healthy.\n");
  process.exit(0);
}

const dbUrl = resolveAuditDbUrl();
if (!dbUrl) {
  console.warn("[cron-audit] No Postgres URL — using HTTP watchdog fallback");
  await auditViaWatchdog();
}

// A private RDS/proxy endpoint is NOT reachable from GitHub Actions or a cloud agent, ever. Going
// straight to the watchdog skips a guaranteed 10s failure and the misleading error that follows it.
if (isPrivateVpcDbUrl(dbUrl)) {
  console.warn("[cron-audit] DB URL is a private VPC endpoint — using HTTP watchdog fallback");
  await auditViaWatchdog();
}

const client = createAuditClient(dbUrl);
try {
  await client.connect();
} catch (e) {
  // FALL BACK ON ANY CONNECT FAILURE, not only on recognised ones.
  //
  // This gate used to require the error message to match `isPrivateDbUnreachableError` or
  // `isStaleAuditDbAuthError`. On 2026-08-10 the driver began throwing an error whose `.message`
  // was EMPTY, so neither pattern matched, the fallback was skipped, and every scheduled run
  // hard-failed while logging `Postgres connect failed: ` with nothing after the colon.
  //
  // The classifier was the wrong shape for the job. The watchdog exists BECAUSE this connection
  // routinely cannot be made from CI, so an unrecognised failure is exactly the case that most
  // needs it — gating on a string match meant every NEW failure mode disabled the safety net.
  //
  // This is fail-safe, not fail-open: `auditViaWatchdog` exits non-zero whenever the crons are
  // genuinely unhealthy, so no real alert is lost. What is lost is the ability of a string-match
  // miss to turn a healthy platform into a red build.
  const detail = describeConnectError(e);
  console.warn(`[cron-audit] Postgres connect failed (${detail}) — using HTTP watchdog fallback`);
  await auditViaWatchdog();
}

const q = async (sql, params) => (await client.query(sql, params)).rows;

console.log("\n=== CRON AUDIT: latest run per job_key ===\n");
const latest = await q(
  `SELECT job_key, status, started_at, LEFT(COALESCE(message,''),80) AS msg
   FROM cron_job_runs
   WHERE (job_key, started_at) IN (
     SELECT job_key, MAX(started_at) FROM cron_job_runs GROUP BY job_key
   )
   ORDER BY job_key`
);
for (const r of latest) {
  console.log(`${r.job_key}\t${r.status}\t${String(r.started_at).slice(0, 19)}\t${r.msg ?? ""}`);
}

const valuesClause = JOB_KEYS.map((_, i) => `($${i + 1})`).join(", ");
console.log(`\n=== CRON AUDIT: total runs (all ${JOB_KEYS.length} keys) ===\n`);
const totals = await q(
  `SELECT j.key AS job_key, COALESCE(c.cnt,0)::int AS total_runs
   FROM (VALUES ${valuesClause}) AS j(key)
   LEFT JOIN (SELECT job_key, COUNT(*)::int AS cnt FROM cron_job_runs GROUP BY job_key) c
     ON c.job_key = j.key
   ORDER BY total_runs ASC, job_key`,
  JOB_KEYS
);
for (const r of totals) {
  console.log(`${r.job_key}\t${r.total_runs}`);
}

const zeroRuns = totals.filter((r) => r.total_runs === 0).map((r) => r.job_key);
const pendingZero = zeroRuns.filter((k) => PROVISION_PENDING.has(k));
const fatalZero = zeroRuns.filter((k) => !PROVISION_PENDING.has(k));
const badLatest = latest.filter((r) => r.status !== "ok" && r.status !== "skipped");

console.log("\n=== CRON AUDIT: summary ===\n");
console.log(`Jobs with zero runs ever: ${zeroRuns.length ? zeroRuns.join(", ") : "(none)"}`);
if (pendingZero.length) {
  console.log(`Provision pending (expected zero until cron service wired): ${pendingZero.join(", ")}`);
}
console.log(`Jobs with latest status != ok/skipped: ${badLatest.length ? badLatest.map((r) => r.job_key).join(", ") : "(none)"}`);

await client.end();
process.exit(fatalZero.length || badLatest.length ? 1 : 0);
