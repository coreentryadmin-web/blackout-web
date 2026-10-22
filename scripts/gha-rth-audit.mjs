#!/usr/bin/env node
/**
 * GitHub Actions RTH audit.
 *
 * Env (GitHub Actions secrets):
 *   CRON_SECRET          — required (premium API + cron routes)
 *   POLYGON_API_KEY      — optional (SPX oracle in full-site audit)
 *   DATABASE_PUBLIC_URL  — optional (Postgres writer/cron freshness checks)
 *   SENTRY_AUTH_TOKEN    — optional (Sentry token smoke)
 *   CRON_TARGET_BASE_URL — optional (default https://blackouttrades.com)
 *
 * Usage:
 *   node scripts/gha-rth-audit.mjs
 *   node scripts/gha-rth-audit.mjs --smoke-only
 *   node scripts/gha-rth-audit.mjs --force   # Postgres RTH checks even off-hours
 */
import { spawnSync } from "node:child_process";
import { etParts, inRthOpenWindow, isTradingDayEt, todayEtYmd } from "./gha-et-window.mjs";
import {
  auditPgSsl,
  resolveAuditDbUrl,
  describeConnectError,
  isStaleAuditDbAuthError,
  isTransientAuditPgError,
} from "./pg-audit.mjs";
import { isCronRunHealthyStatus, probeOptionsSocketWithRetries } from "./lib/rth-socket-probe.mjs";

const smokeOnly = process.argv.includes("--smoke-only");
const force = process.argv.includes("--force");
const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET?.trim() ?? "";

if (!CRON) {
  console.error("[gha-rth-audit] CRON_SECRET is required");
  process.exit(1);
}

const failures = [];
const et = etParts();
const { label: etLabel, mins: etMins } = et;
const rthOpen = inRthOpenWindow();
const afterOpen930 = etMins >= 9 * 60 + 30;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PG_AUDIT_MAX_ATTEMPTS = Math.max(1, Number(process.env.GHA_PG_AUDIT_ATTEMPTS ?? 3) || 3);

function run(label, cmd, args, extraEnv = {}) {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, CRON_TARGET_BASE_URL: BASE, ...extraEnv },
  });
  if (r.status !== 0) failures.push(label);
  return r.status === 0;
}

async function postgresRthChecks() {
  const dbUrl = resolveAuditDbUrl();
  if (!dbUrl) {
    console.log("\n── Postgres RTH checks ──");
    console.log("  ⚠ DATABASE_PUBLIC_URL not set — skipping");
    return;
  }

  console.log(`\n── Postgres RTH checks (${etLabel}) ──`);
  if (!force && !inRthOpenWindow()) {
    console.log("  ⚠ Off-hours / weekend — skipping market-hours Postgres checks (use --force to override)");
    return;
  }

  const tradingDay = isTradingDayEt(todayEtYmd());
  if (!tradingDay) {
    console.log(
      `  ⚠ ${todayEtYmd()} is not a US equity trading session (market holiday) — skipping writer/regime freshness checks`
    );
  }

  const runOnce = async () => {
    const pg = await import("pg");
    const c = new pg.default.Client({
      connectionString: dbUrl,
      ssl: auditPgSsl(dbUrl),
    });
    await c.connect();

    const q = async (sql) => (await c.query(sql)).rows;
    const ok = (m) => console.log(`  ✓ ${m}`);
    const fail = (m) => {
      failures.push(`postgres: ${m}`);
      console.log(`  ✗ ${m}`);
    };

    try {
      if (tradingDay) {
        const eval20 = (await q(
          `SELECT COUNT(*)::int AS n FROM cron_job_runs
           WHERE job_key = 'spx-evaluate' AND started_at > NOW() - INTERVAL '20 minutes' AND status = 'ok'`
        ))[0].n;
        if (eval20 > 0) ok(`spx-evaluate ok in last 20m (${eval20})`);
        else fail("spx-evaluate: no ok run in last 20m");

        const regime20 = (await q(
          `SELECT COUNT(*)::int AS n FROM market_regime WHERE captured_at > NOW() - INTERVAL '20 minutes'`
        ))[0].n;
        if (regime20 > 0) ok(`market_regime writes last 20m: ${regime20}`);
        else fail("market_regime: no writes in last 20m");

        const stale = await q(
          `SELECT job_key, status, started_at FROM cron_job_runs
           WHERE job_key IN ('heatmap-warm','flow-ingest')
           AND started_at > NOW() - INTERVAL '30 minutes'
           AND status = 'ok'`
        );
        if (stale.length >= 1) ok(`Writer crons active (${stale.map((r) => r.job_key).join(", ")})`);
        else fail(`Writer crons thin in last 30m — only ${stale.length} ok runs`);
      }

      const dc = await q(
        `SELECT status, message FROM cron_job_runs WHERE job_key = 'data-correctness' ORDER BY started_at DESC LIMIT 1`
      );
      const latest = dc[0];
      if (isCronRunHealthyStatus(latest?.status)) {
        ok(`data-correctness latest run ${latest.status}`);
      } else {
        fail(`data-correctness latest: ${latest?.status ?? "?"} — ${latest?.message ?? ""}`);
      }
    } finally {
      await c.end().catch(() => undefined);
    }
  };

  for (let attempt = 1; attempt <= PG_AUDIT_MAX_ATTEMPTS; attempt++) {
    try {
      await runOnce();
      return;
    } catch (e) {
      const detail = describeConnectError(e);
      const skip =
        isStaleAuditDbAuthError(detail) ||
        isTransientAuditPgError(e) ||
        /no pg_hba\.conf entry|SASL|does not exist/i.test(detail);
      if (skip) {
        console.log(`  ⚠ Postgres UNAVAILABLE — checks SKIPPED, not failed: ${detail}`);
        console.log(
          "     Transient connect blip or audit DATABASE_PUBLIC_URL — not treated as a production data fault."
        );
        return;
      }
      if (attempt < PG_AUDIT_MAX_ATTEMPTS) {
        console.log(
          `  ⚠ Postgres attempt ${attempt}/${PG_AUDIT_MAX_ATTEMPTS} failed (${detail}) — retrying…`
        );
        await sleep(1500 * attempt);
        continue;
      }
      failures.push(`postgres: ${detail}`);
      console.log(`  ✗ Postgres: ${detail}`);
    }
  }
}

async function cronHttpChecks() {
  console.log("\n── Cron HTTP checks ──");
  const H = { Authorization: `Bearer ${CRON}` };
  const routes = [
    { path: "/api/cron/data-correctness?force=1", label: "data-correctness" },
    { path: "/api/cron/data-integrity?force=1", label: "data-integrity" },
    { path: "/api/cron/provider-health-reconcile?force=1", label: "provider-health" },
    { path: "/api/cron/cron-staleness-watchdog", label: "cron-watchdog" },
  ];

  for (const { path, label } of routes) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers: H });
      const json = await res.json().catch(() => ({}));
      // 202 is a SUCCESS, and specifically a "dispatched, no verdict yet" success.
      //
      // /api/cron/data-correctness returns `202 {ok:true, status:"accepted"}` when it fires the
      // full-platform sweep in the background (fire-and-forget, to stay inside the Cloudflare
      // origin timeout). Treating any non-200 as a failure made this audit RED on every run that
      // took the async path — a permanently-red monitor for a route behaving exactly as designed,
      // which is how a reader learns to ignore the whole report.
      //
      // It is reported as NOT VERIFIED rather than ✓, because a dispatch is not a result: the
      // sweep's actual findings land later in `cron_job_runs`, which the Postgres section below
      // checks. Calling it green here would be the opposite mistake — a check that cannot fail.
      if (res.status === 202) {
        console.log(`  ⚠ ${label} → 202 accepted (sweep dispatched async — no verdict this run)`);
        continue;
      }
      if (res.status !== 200) {
        failures.push(`${label}: HTTP ${res.status}`);
        console.log(`  ✗ ${label} → HTTP ${res.status}`);
        continue;
      }
      if (label === "data-correctness" && (json.flags?.length ?? 0) > 0) {
        failures.push(`${label}: ${json.flags.length} flags`);
        console.log(`  ✗ ${label} → ${json.flags.length} flags`);
        for (const f of json.flags.slice(0, 5)) console.log(`      [${f.layer}/${f.metric}] ${f.detail}`);
      } else if (label === "data-integrity" && (json.discrepancies ?? json.issues?.length ?? 0) > 0) {
        failures.push(`${label}: discrepancies`);
        console.log(`  ✗ ${label} → discrepancies`);
      } else if (label === "cron-watchdog" && (json.problems ?? 0) > 0) {
        failures.push(`${label}: ${(json.problem_keys ?? []).join(", ")}`);
        console.log(`  ✗ ${label} → stale: ${(json.problem_keys ?? []).join(", ")}`);
      } else {
        console.log(`  ✓ ${label} → ok`);
      }
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
      console.log(`  ✗ ${label} → ${e.message}`);
    }
  }

  const socketResult = await probeOptionsSocketWithRetries({
    afterOpen930,
    fetchSocketHealth: async () => {
      const res = await fetch(`${BASE}/api/cron/socket-health`, { headers: H });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    },
    onRetry: (attempt, detail) => {
      console.log(`  ⚠ socket-health (attempt ${attempt}/3): ${detail} — retrying…`);
    },
  });
  if (socketResult.preOpenWarn) {
    console.log(`  ⚠ socket-health: ${socketResult.preOpenWarn}`);
  } else if (socketResult.successDetail) {
    console.log(`  ✓ socket-health → ${socketResult.successDetail}`);
  } else if (socketResult.ok) {
    console.log(`  ✓ socket-health → ok`);
  }
  if (socketResult.failure) {
    failures.push(socketResult.failure);
    console.log(`  ✗ socket-health → ${socketResult.failure}`);
  }
}

console.log(`\n=== GitHub Actions RTH audit ===`);
console.log(`Target: ${BASE}`);
console.log(`Time:   ${new Date().toISOString()} (${etLabel})`);
console.log(`RTH:    ${rthOpen ? "open" : "closed/off-hours"}${force ? " (--force)" : ""}\n`);

// Public HTTP smoke (always)
run("Public HTTP smoke", "node", ["scripts/gha-http-smoke.mjs"]);

// Optional Sentry token smoke (never fails the run when token absent)
run("Sentry smoke", "node", ["scripts/gha-sentry-smoke.mjs"]);

if (!smokeOnly) {
  run("Full-site deep audit", "node", ["scripts/full-site-deep-audit.mjs"]);
  await cronHttpChecks();
  await postgresRthChecks();
}

console.log("\n=== Summary ===");
if (failures.length) {
  console.error(`FAILED (${failures.length}):`);
  failures.forEach((f) => console.error(`  · ${f}`));
  process.exit(1);
}
console.log("GREEN — GHA RTH audit passed.\n");
