#!/usr/bin/env node
/**
 * Post-deploy validation — run after every push to main (Railway auto-deploy).
 *
 * Usage:
 *   node scripts/validate-deploy.mjs
 *   CRON_TARGET_BASE_URL=https://blackouttrades.com node scripts/validate-deploy.mjs
 *
 * Env (optional):
 *   DATABASE_PUBLIC_URL or DATABASE_URL — Postgres smoke (errors, cron, API telemetry)
 *   SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT — Sentry unresolved issue count
 *
 * Requires: railway CLI (logged in), curl, node 20+, pg (npm package)
 */

import { execSync } from "node:child_process";
import { spawnSync } from "node:child_process";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const failures = [];
const warnings = [];

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function warn(msg) {
  warnings.push(msg);
  console.log(`  ⚠ ${msg}`);
}
function fail(msg) {
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body };
}

console.log("\n=== BlackOut post-deploy validation ===\n");
console.log(`Target: ${BASE}`);
console.log(`Time:   ${new Date().toISOString()}\n`);

// ── 1. Railway deploy ───────────────────────────────────────────────────────
console.log("1. Railway (blackout-web)");
try {
  const latest = sh("railway deployment list --service blackout-web 2>/dev/null | sed -n '2p'");
  console.log(`     ${latest}`);
  if (/SUCCESS/i.test(latest)) ok("Latest deployment SUCCESS");
  else if (/BUILDING|DEPLOYING|QUEUED/i.test(latest)) fail(`Deploy not finished: ${latest}`);
  else fail(`Deploy unhealthy: ${latest}`);

  const status = sh("railway status 2>/dev/null | rg 'blackout-web' || true");
  if (/Online/i.test(status) && !/Building|Queued|Failed/i.test(status)) ok("Service Online");
  else if (/Building|Queued/i.test(status)) warn(`Service still rolling: ${status.trim()}`);
  else warn(status.trim() || "Could not read service status");
} catch (e) {
  fail(`Railway CLI: ${e.message}`);
}

// ── 2. Live HTTP smoke ──────────────────────────────────────────────────────
console.log("\n2. Live HTTP smoke");
const checks = [
  { path: "/api/health", expect: 200, field: (b) => b.ok === true },
  { path: "/api/ready", expect: 200, field: (b) => b.ok === true && b.db !== "unreachable" },
  { path: "/api/market/regime", expect: 200, field: (b) => b.available === true },
  { path: "/api/public/track-record", expect: 200, field: (b) => b.available === true },
  { path: "/api/signals/open", expect: 401 },
  { path: "/api/admin/debug-uw", expect: 401 },
  { path: "/api/engine/health", expect: 401 },
  { path: "/", expect: 200 },
  { path: "/track-record", expect: 200 },
  { path: "/sign-in", expect: 200 },
];

for (const c of checks) {
  try {
    const { status, body } = await fetchJson(c.path);
    const pass = status === c.expect && (c.field ? c.field(body) : true);
    if (pass) ok(`${c.path} → ${status}`);
    else fail(`${c.path} → ${status} (expected ${c.expect}) ${JSON.stringify(body).slice(0, 80)}`);
  } catch (e) {
    fail(`${c.path} fetch failed: ${e.message}`);
  }
}

// ── 3. Postgres (errors, cron, rate limits) ─────────────────────────────────
console.log("\n3. Postgres / error sink / API telemetry");
let dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  try {
    const raw = sh("railway variables --service blackout-web --json 2>/dev/null");
    const vars = JSON.parse(raw);
    dbUrl = vars.DATABASE_PUBLIC_URL || vars.DATABASE_URL;
  } catch {
    /* optional */
  }
}

if (dbUrl) {
  try {
    const pg = await import("pg");
    const client = new pg.default.Client({
      connectionString: dbUrl,
      ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false },
    });
    await client.connect();

    const q = async (sql) => (await client.query(sql)).rows;
    const errors1h = (await q("SELECT COUNT(*)::int AS n FROM error_events WHERE created_at > NOW() - INTERVAL '1 hour'"))[0].n;
    const errors24h = (await q("SELECT COUNT(*)::int AS n FROM error_events WHERE created_at > NOW() - INTERVAL '24 hours'"))[0].n;
    const cronBad = await q(
      "SELECT job_key, status, LEFT(COALESCE(message,''),60) AS msg FROM cron_job_runs WHERE started_at > NOW() - INTERVAL '1 hour' AND status NOT IN ('ok','skipped') LIMIT 5"
    );
    const apiFail = (await q("SELECT COUNT(*)::int AS n FROM api_telemetry_events WHERE at > NOW() - INTERVAL '1 hour' AND ok = false"))[0].n;
    const rateLimited = (await q("SELECT COUNT(*)::int AS n FROM api_telemetry_events WHERE at > NOW() - INTERVAL '1 hour' AND rate_limited = true"))[0].n;
    const regime1h = (await q("SELECT COUNT(*)::int AS n FROM market_regime WHERE captured_at > NOW() - INTERVAL '1 hour'"))[0].n;
    const spxPlays = (await q("SELECT COUNT(*)::int AS n FROM spx_open_play WHERE opened_at > NOW() - INTERVAL '24 hours'"))[0].n;

    if (errors1h === 0) ok(`error_events last 1h: ${errors1h}`);
    else warn(`error_events last 1h: ${errors1h} (check Sentry / admin/errors)`);

    ok(`error_events last 24h: ${errors24h}`);
    ok(`market_regime writes last 1h: ${regime1h}`);
    ok(`spx_open_play last 24h: ${spxPlays}`);

    if (apiFail === 0) ok(`API telemetry failures last 1h: ${apiFail}`);
    else warn(`API telemetry failures last 1h: ${apiFail}`);

    if (rateLimited === 0) ok(`Rate-limited upstream calls last 1h: ${rateLimited}`);
    else warn(`Rate-limited upstream calls last 1h: ${rateLimited}`);

    if (cronBad.length === 0) ok("No cron failures (non-skipped) in last 1h");
    else cronBad.forEach((r) => warn(`cron ${r.job_key}: ${r.status} — ${r.msg}`));

    await client.end();
  } catch (e) {
    fail(`Postgres query failed: ${e.message}`);
  }
} else {
  warn("DATABASE_PUBLIC_URL not set — skipping Postgres checks");
}

// ── 4. Sentry (optional — needs auth token) ─────────────────────────────────
console.log("\n4. Sentry");
const sentryToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;

if (sentryToken && sentryOrg) {
  try {
    const url = sentryProject
      ? `https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/issues/?query=is:unresolved&limit=10`
      : `https://sentry.io/api/0/organizations/${sentryOrg}/issues/?query=is:unresolved&limit=10`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${sentryToken}` } });
    if (res.ok) {
      const issues = await res.json();
      if (!issues.length) ok("Sentry: 0 unresolved issues (sampled)");
      else {
        warn(`Sentry: ${issues.length}+ unresolved issues`);
        issues.slice(0, 3).forEach((i) => console.log(`       · ${i.title?.slice(0, 80)}`));
      }
    } else {
      warn(`Sentry API ${res.status} — check SENTRY_AUTH_TOKEN scopes`);
    }
  } catch (e) {
    warn(`Sentry check failed: ${e.message}`);
  }
} else {
  warn("SENTRY_AUTH_TOKEN unset — using error_events table as mirror (see step 3)");
  try {
    const raw = sh("railway variables --service blackout-web --json 2>/dev/null");
    const vars = JSON.parse(raw);
    if (vars.SENTRY_DSN) ok("SENTRY_DSN configured on Railway (events forwarding active)");
    else warn("SENTRY_DSN not set on Railway");
  } catch {
    /* ignore */
  }
}

// ── 5. Railway logs — options-socket / uw-socket churn ───────────────────────
console.log("\n5. Railway logs (socket churn)");
try {
  const logs = sh("railway logs --service blackout-web 2>/dev/null | rg 'options-socket|uw-socket' | tail -30");
  const opt1006 = (logs.match(/options-socket.*1006.*failures=(\d+)/g) || []);
  const lastFail = opt1006.length ? Number(opt1006[opt1006.length - 1].match(/failures=(\d+)/)?.[1] ?? 0) : 0;
  const optAuth = /options-socket.*authenticated/.test(logs);
  if (lastFail >= 10) fail(`options-socket 1006 loop — failures=${lastFail} (Night's Watch marks may degrade)`);
  else if (lastFail > 0) warn(`options-socket recent 1006 failures=${lastFail}`);
  else if (optAuth) ok("options-socket authenticated in recent logs");
  else warn("options-socket: no recent authenticated line (may be off-hours or disabled)");

  if (/uw-socket.*stall watchdog/i.test(logs)) warn("uw-socket stall reconnects in recent logs");
  else ok("No uw-socket stall storms in recent logs");
} catch {
  warn("Could not read Railway logs");
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n=== Summary ===");
if (warnings.length) {
  console.log(`Warnings (${warnings.length}):`);
  warnings.forEach((w) => console.log(`  · ${w}`));
}
if (failures.length) {
  console.log(`\nFAILED (${failures.length}):`);
  failures.forEach((f) => console.log(`  · ${f}`));
  process.exit(1);
}
console.log("\nGREEN — deploy validation passed.\n");
