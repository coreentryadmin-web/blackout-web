#!/usr/bin/env node
/**
 * Post-deploy validation — run after every push to main (ECS auto-deploy).
 *
 * Usage:
 *   node scripts/validate-deploy.mjs
 *   CRON_TARGET_BASE_URL=https://blackouttrades.com node scripts/validate-deploy.mjs
 *
 * Env (optional):
 *   DATABASE_PUBLIC_URL or DATABASE_URL — Postgres smoke (errors, cron, API telemetry)
 *   SENTRY_AUTH_TOKEN — Sentry dashboard check (ORG/PROJECT auto-discovered from token + DSN)
 *
 * Requires: railway CLI (logged in), curl, node 20+, pg (npm package)
 */

import { execSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { ALL_CRON_KEYS } from "./railway-cron-services.mjs";
import { createAuditClient, resolveAuditDbUrl, isPrivateDbUnreachableError } from "./pg-audit.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { prodSecret, auditSecret } from "./audit/lib/prod-secrets.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const IS_STAGING = BASE.includes("staging.");
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

function actionableDeployment(output) {
  const rows = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f-]+\s+\|/i.test(line));
  const ignored = rows.filter((line) => /\|\s*(SKIPPED|REMOVED)\s*\|/i.test(line));
  const actionable = rows.find((line) => !/\|\s*(SKIPPED|REMOVED)\s*\|/i.test(line));
  return { actionable, ignored };
}

function loadProdVars() {
  try {
    return JSON.parse(sh("railway variables --service blackout-web --json 2>/dev/null"));
  } catch {
    return {};
  }
}

function hasRailwayCli() {
  try {
    sh("command -v railway >/dev/null 2>&1 && railway --version 2>/dev/null | head -1");
    return true;
  } catch {
    return false;
  }
}

function resolveCronSecret() {
  const fromEnv = auditSecret("CRON_SECRET");
  if (fromEnv) return fromEnv;
  if (IS_STAGING) {
    try {
      const raw = sh(
        'aws secretsmanager get-secret-value --secret-id blackout-staging/app/env --query SecretString --output text'
      );
      const secret = JSON.parse(raw);
      return secret.CRON_SECRET?.trim() ?? "";
    } catch {
      return "";
    }
  }
  const fromAws = prodSecret("CRON_SECRET");
  if (fromAws) return fromAws;
  const vars = loadProdVars();
  return vars.CRON_SECRET?.trim() ?? "";
}

/** Parse numeric project id from SENTRY_DSN (no secrets returned). */
function dsnProjectId(dsn) {
  const m = String(dsn ?? "").match(/@[^/]+\/(\d+)/);
  return m ? m[1] : null;
}

/** Resolve org slug (+ optional project slug) from token alone — ORG/PROJECT env not required. */
async function resolveSentryFromToken(token) {
  const orgRes = await fetch("https://sentry.io/api/0/organizations/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!orgRes.ok) {
    throw new Error(`organizations API ${orgRes.status}`);
  }
  const orgs = await orgRes.json();
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error("token returned 0 organizations");
  }
  const org = orgs[0];
  let projectSlug = null;
  try {
    const projRes = await fetch(
      `https://sentry.io/api/0/organizations/${org.slug}/projects/`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (projRes.ok) {
      const projects = await projRes.json();
      const rw = loadProdVars();
      const dsnId = dsnProjectId(rw.SENTRY_DSN || rw.NEXT_PUBLIC_SENTRY_DSN);
      if (dsnId && Array.isArray(projects)) {
        const hit = projects.find((p) => String(p.id) === dsnId);
        projectSlug = hit?.slug ?? null;
      }
      if (!projectSlug && projects?.length === 1) projectSlug = projects[0].slug;
    }
  } catch {
    /* project list optional */
  }
  return { orgSlug: org.slug, orgName: org.name, projectSlug };
}

const SENTRY_TEST_ISSUE = /wiring validation.*safe to resolve|DsnValidation.*Test event/i;

async function fetchSentryUnresolved(token, orgSlug, projectSlug) {
  const url = projectSlug
    ? `https://sentry.io/api/0/projects/${orgSlug}/${projectSlug}/issues/?query=is:unresolved&limit=25&statsPeriod=24h`
    : `https://sentry.io/api/0/organizations/${orgSlug}/issues/?query=is:unresolved&limit=25&statsPeriod=24h`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`issues API ${res.status}`);
  return res.json();
}

/** Auto-resolve known wiring/test events so the dashboard stays clean. */
async function resolveSentryTestIssues(token, issues) {
  let resolved = 0;
  for (const issue of issues) {
    const title = issue.title ?? issue.culprit ?? "";
    if (!SENTRY_TEST_ISSUE.test(title)) continue;
    const res = await fetch(`https://sentry.io/api/0/issues/${issue.id}/`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    if (res.ok) resolved += 1;
  }
  return resolved;
}

async function fetchJson(path, opts = {}) {
  const retries = IS_STAGING ? 4 : 1;
  const res = await fetchRetry(`${BASE}${path}`, opts, { retries, baseDelayMs: 1500, timeoutMs: 60_000 });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body, text };
}

async function fetchText(path, opts = {}) {
  const { status, text } = await fetchJson(path, opts);
  return { status, text: typeof text === "string" ? text : String(text) };
}

console.log("\n=== BlackOut post-deploy validation ===\n");
console.log(`Target: ${BASE}`);
console.log(`Time:   ${new Date().toISOString()}\n`);

// ── 1. Production deploy ────────────────────────────────────────────────────
console.log("1. Production (blackout-web)");
const skipCli =
  process.env.SKIP_RAILWAY === "1" ||
  IS_STAGING ||
  !hasRailwayCli() ||
  (process.env.GITHUB_ACTIONS === "true" && !process.env.RAILWAY_TOKEN?.trim());

if (skipCli) {
  warn(
    hasRailwayCli()
      ? "Production CLI checks skipped (GITHUB_ACTIONS or SKIP_RAILWAY=1)"
      : "Production CLI checks skipped (Railway CLI not installed — using HTTP/ECS probes)"
  );
  if (!IS_STAGING) {
    try {
      const out = sh(
        'aws ecs describe-services --cluster blackout-production-cluster --services blackout-production-web --query "services[0].{status:status,running:runningCount,desired:desiredCount,deployments:deployments[0].rolloutState}" --output json 2>/dev/null'
      );
      const svc = JSON.parse(out);
      if (svc?.status === "ACTIVE" && svc.running === svc.desired && svc.deployments === "COMPLETED") {
        ok(`ECS blackout-production-web ${svc.running}/${svc.desired} ACTIVE rollout=${svc.deployments}`);
      } else if (svc?.status === "ACTIVE") {
        warn(`ECS blackout-production-web ${svc.running}/${svc.desired} rollout=${svc.deployments ?? "?"}`);
      } else {
        warn(`ECS describe-services: ${out.slice(0, 120)}`);
      }
    } catch {
      warn("ECS deploy status unavailable — HTTP smoke only");
    }
  }
} else {
try {
  const deployments = sh("railway deployment list --service blackout-web 2>/dev/null");
  const { actionable: latest, ignored } = actionableDeployment(deployments);
  if (ignored.length) warn(`Ignored ${ignored.length} skipped/removed deployment row(s)`);
  if (latest) console.log(`     ${latest}`);
  else warn("No actionable deployment row found");
  if (/SUCCESS/i.test(latest)) ok("Latest deployment SUCCESS");
  else if (/BUILDING|DEPLOYING|QUEUED/i.test(latest)) fail(`Deploy not finished: ${latest}`);
  else if (latest) fail(`Deploy unhealthy: ${latest}`);

  const status = sh("railway status 2>/dev/null | rg 'blackout-web' || true");
  if (/Online/i.test(status) && !/Building|Queued|Failed/i.test(status)) ok("Service Online");
  else if (/Building|Queued/i.test(status)) warn(`Service still rolling: ${status.trim()}`);
  else warn(status.trim() || "Could not read service status");
} catch (e) {
  // Railway is legacy — prod deploys via ECS (ecr-push-production.yml). A missing
  // or logged-out CLI must not block HTTP smoke / RTH-open when ECS is healthy.
  warn(`Deploy CLI: ${e.message} (Railway deprecated — rely on ECS deploy smoke)`);
}
}

// ── 2. Live HTTP smoke ──────────────────────────────────────────────────────
console.log("\n2. Live HTTP smoke");
const checks = [
  { path: "/api/health", expect: 200, field: (b) => b.ok === true },
  { path: "/api/ready", expect: 200, field: (b) => b.ok === true && b.db !== "unreachable" },
  { path: "/api/market/regime", expect: 200, field: (b) => IS_STAGING ? b.available === true || b.available === false : b.available === true },
  { path: "/api/public/track-record", expect: 401 },
  { path: "/api/signals/open", expect: 401 },
  { path: "/api/admin/debug-uw", expect: 401 },
  { path: "/api/engine/health", expect: 401 },
  { path: "/", expect: 200 },
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

const seoChecks = [
  {
    path: "/robots.txt",
    expect: 200,
    test: (text) =>
      text.includes("User-Agent: *") &&
      text.includes("Allow: /") &&
      text.includes(`Sitemap: ${BASE}/sitemap.xml`),
  },
  {
    path: "/sitemap.xml",
    expect: 200,
    test: (text) => text.includes("<urlset") && text.includes(`${BASE}/learn`) && text.includes(`${BASE}/methodology`),
  },
];

for (const c of seoChecks) {
  try {
    const { status, text } = await fetchText(c.path);
    const pass = status === c.expect && c.test(text);
    if (pass) ok(`${c.path} → ${status}`);
    else fail(`${c.path} → ${status} (expected ${c.expect})`);
  } catch (e) {
    fail(`${c.path} fetch failed: ${e.message}`);
  }
}

// Marketing trust surfaces — anonymous HTML must not expose paid-sync before Clerk hydrates.
console.log("\n2a. Marketing funnel gates");
try {
  const { status: upgradeStatus, text: upgradeHtml } = await fetchText("/upgrade");
  if (upgradeStatus !== 200) {
    fail(`/upgrade → ${upgradeStatus} (expected 200)`);
  } else {
    const hasSignIn = /Sign in to sync/i.test(upgradeHtml);
    const hasPaid = /I paid|refresh my access/i.test(upgradeHtml);
    if (hasSignIn && !hasPaid) ok("/upgrade anonymous HTML → sign-in sync only");
    else fail(`/upgrade anonymous HTML exposes paid sync (signIn=${hasSignIn} paid=${hasPaid})`);
  }
} catch (e) {
  fail(`/upgrade marketing gate failed: ${e.message}`);
}

try {
  const { status: methStatus, text: methHtml } = await fetchText("/methodology");
  if (methStatus !== 200) {
    warn(`/methodology → ${methStatus} (expected 200 after deploy)`);
  } else if (/Grading methodology|Public record/i.test(methHtml) && /never blended|three methodologies/i.test(methHtml)) {
    ok("/methodology → trust copy present");
  } else {
    fail("/methodology → missing expected trust copy");
  }
} catch (e) {
  warn(`/methodology gate skipped: ${e.message}`);
}

// ── 2b. Desk cache warm (post-deploy cold-path guard) ───────────────────────
console.log("\n2b. Cache warmers");
const cronSecret = resolveCronSecret();
const warmPaths = IS_STAGING
  ? ["/api/cron/desk-warm?force=1", "/api/cron/heatmap-warm?force=1", "/api/cron/zerodte-warm?force=1"]
  : ["/api/cron/desk-warm?force=1"];
if (cronSecret) {
  for (const warmPath of warmPaths) {
    try {
      const t0 = Date.now();
      const warmRes = await fetchRetry(
        `${BASE}${warmPath}`,
        { headers: { Authorization: `Bearer ${cronSecret}` } },
        { retries: IS_STAGING ? 4 : 2, baseDelayMs: 1500, timeoutMs: 300_000 }
      );
      const warmBody = await warmRes.json().catch(() => ({}));
      const warmMs = Date.now() - t0;
      const label = warmPath.split("?")[0].replace("/api/cron/", "");
      if (warmRes.ok && warmBody.ok !== false) {
        ok(`${label} → ok (${warmMs}ms)`);
      } else if (warmRes.ok && warmBody.skipped) {
        warn(`${label} skipped (${warmMs}ms)`);
      } else {
        warn(`${label} → HTTP ${warmRes.status} (${warmMs}ms)`);
      }
    } catch (e) {
      warn(`${warmPath} failed: ${e.message}`);
    }
  }
} else {
  warn("CRON_SECRET unset — post-deploy cache warm skipped");
}

// ── 3. Postgres (errors, cron, rate limits) ─────────────────────────────────
console.log("\n3. Postgres / error sink / API telemetry");
const dbUrl = resolveAuditDbUrl();

if (IS_STAGING && dbUrl) {
  warn("Staging Postgres checks run on ECS only (RDS is private) — use cron_job_runs via /api/cron/*");
} else if (dbUrl) {
  try {
    const client = createAuditClient(dbUrl);
    await client.connect();

    const q = async (sql, params) => (await client.query(sql, params)).rows;
    const errors1h = (await q("SELECT COUNT(*)::int AS n FROM error_events WHERE created_at > NOW() - INTERVAL '1 hour'"))[0].n;
    const errors24h = (await q("SELECT COUNT(*)::int AS n FROM error_events WHERE created_at > NOW() - INTERVAL '24 hours'"))[0].n;
    // Latest run per job — historical failures during rolling deploys are not actionable.
    const cronLatest = await q(`
      SELECT DISTINCT ON (job_key) job_key, status, LEFT(COALESCE(message,''),60) AS msg
      FROM cron_job_runs
      ORDER BY job_key, started_at DESC
    `);
    const cronBad = cronLatest.filter((r) => !["ok", "skipped"].includes(r.status));
    const apiFail15m = (
      await q(
        "SELECT COUNT(*)::int AS n FROM api_telemetry_events WHERE at > NOW() - INTERVAL '15 minutes' AND ok = false AND rate_limited = false"
      )
    )[0].n;
    const rateLimited = (await q("SELECT COUNT(*)::int AS n FROM api_telemetry_events WHERE at > NOW() - INTERVAL '1 hour' AND rate_limited = true"))[0].n;
    const regime1h = (await q("SELECT COUNT(*)::int AS n FROM market_regime WHERE captured_at > NOW() - INTERVAL '1 hour'"))[0].n;
    const spxPlays = (await q("SELECT COUNT(*)::int AS n FROM spx_open_play WHERE opened_at > NOW() - INTERVAL '24 hours'"))[0].n;

    if (errors1h === 0) ok(`error_events last 1h: ${errors1h}`);
    else warn(`error_events last 1h: ${errors1h} (check Sentry / admin/errors)`);

    ok(`error_events last 24h: ${errors24h}`);
    ok(`market_regime writes last 1h: ${regime1h}`);
    ok(`spx_open_play last 24h: ${spxPlays}`);

    if (apiFail15m === 0) ok(`API telemetry failures last 15m (excl. rate-limit): ${apiFail15m}`);
    else warn(`API telemetry failures last 15m (excl. rate-limit): ${apiFail15m}`);

    if (rateLimited === 0) ok(`Rate-limited upstream calls last 1h: ${rateLimited}`);
    else ok(`Rate-limited upstream calls last 1h: ${rateLimited} (expected under burst)`);

    if (cronBad.length === 0) ok("All cron jobs latest run ok/skipped");
    else cronBad.forEach((r) => warn(`cron ${r.job_key} latest: ${r.status} — ${r.msg}`));

    const cronKeys = [...ALL_CRON_KEYS];
    const valuesClause = cronKeys.map((_, i) => `($${i + 1})`).join(", ");
    const zeroRuns = (
      await q(
        `SELECT j.key AS job_key FROM (VALUES ${valuesClause}) AS j(key)
         LEFT JOIN (SELECT job_key, COUNT(*)::int AS cnt FROM cron_job_runs GROUP BY job_key) c
           ON c.job_key = j.key
         WHERE COALESCE(c.cnt, 0) = 0
         ORDER BY j.key`,
        cronKeys
      )
    ).map((r) => r.job_key);
    if (zeroRuns.length === 0) ok(`All ${cronKeys.length} registered crons have run history`);
    else warn(`Cron jobs with zero runs ever (cron service may be missing): ${zeroRuns.join(", ")}`);

    await client.end();
  } catch (e) {
    if (isPrivateDbUnreachableError(e.message)) {
      warn(`Postgres unreachable from this host (private RDS) — skipping DB checks: ${e.message}`);
    } else {
      fail(`Postgres query failed: ${e.message}`);
    }
  }
} else {
  warn("DATABASE_PUBLIC_URL not set — skipping Postgres checks");
}

// ── 4. Sentry (token only — auto-discovers org/project) ─────────────────────
console.log("\n4. Sentry");
const rwVars = loadProdVars();
const sentryToken =
  process.env.SENTRY_AUTH_TOKEN?.trim() || rwVars.SENTRY_AUTH_TOKEN?.trim() || "";
const sentryOrgOverride = process.env.SENTRY_ORG?.trim() || rwVars.SENTRY_ORG?.trim() || "";
const sentryProjectOverride =
  process.env.SENTRY_PROJECT?.trim() || rwVars.SENTRY_PROJECT?.trim() || "";

if (sentryToken) {
  try {
    const resolved = sentryOrgOverride
      ? { orgSlug: sentryOrgOverride, orgName: sentryOrgOverride, projectSlug: sentryProjectOverride || null }
      : await resolveSentryFromToken(sentryToken);
    ok(
      `Token valid — org: ${resolved.orgName} (${resolved.orgSlug})` +
        (resolved.projectSlug ? `, project: ${resolved.projectSlug}` : " (org-wide issues)")
    );
    let issues = await fetchSentryUnresolved(
      sentryToken,
      resolved.orgSlug,
      sentryProjectOverride || resolved.projectSlug
    );
    const autoResolved = await resolveSentryTestIssues(sentryToken, issues);
    if (autoResolved > 0) {
      ok(`Auto-resolved ${autoResolved} known test/wiring Sentry issue(s)`);
      issues = await fetchSentryUnresolved(
        sentryToken,
        resolved.orgSlug,
        sentryProjectOverride || resolved.projectSlug
      );
    }
    if (!issues.length) ok("Sentry dashboard: 0 unresolved issues (last 24h sample)");
    else {
      warn(`Sentry dashboard: ${issues.length} unresolved issue(s) in sample`);
      issues.slice(0, 5).forEach((i) => {
        const when = i.lastSeen ? new Date(i.lastSeen).toISOString().slice(0, 16) : "?";
        console.log(`       · [${when}] ${(i.title ?? i.culprit ?? "issue").slice(0, 90)}`);
      });
    }
  } catch (e) {
    if (IS_STAGING) warn(`Sentry API: ${e.message} — skipped on staging`);
    else fail(`Sentry API: ${e.message} — verify token scopes (event:read, org:read, project:read)`);
  }
} else {
  warn("SENTRY_AUTH_TOKEN not found (env or production blackout-web) — using error_events mirror");
  if (rwVars.SENTRY_DSN) ok("SENTRY_DSN configured in production (capture forwarding active)");
  else warn("SENTRY_DSN not set in production");
}

// ── 4b. REPLICA_COUNT (UW/Polygon cluster rate-limit math) ───────────────────
console.log("\n4b. Cluster config");
const replicaCount = Math.max(
  0,
  Math.floor(
    Number(
      (IS_STAGING ? process.env.REPLICA_COUNT : null) ??
        rwVars.REPLICA_COUNT ??
        prodSecret("REPLICA_COUNT") ??
        process.env.REPLICA_COUNT ??
        0
    )
  )
);
let runningReplicas = null;
if (!skipCli) {
  const runningMatch = sh("railway status 2>/dev/null | rg 'blackout-web' || true").match(
    /(\d+)\/(\d+)\s+running/
  );
  runningReplicas = runningMatch ? Number(runningMatch[1]) : null;
} else if (IS_STAGING) {
  try {
    const out = sh(
      'aws ecs describe-services --cluster blackout-staging-cluster --services blackout-staging-web --query "services[0].runningCount" --output text 2>/dev/null'
    );
    const n = Number(out);
    if (Number.isFinite(n)) runningReplicas = n;
  } catch {
    /* optional */
  }
} else {
  try {
    const out = sh(
      'aws ecs describe-services --cluster blackout-production-cluster --services blackout-production-web --query "services[0].runningCount" --output text 2>/dev/null'
    );
    const n = Number(out);
    if (Number.isFinite(n)) runningReplicas = n;
  } catch {
    /* optional */
  }
}
if (replicaCount >= 1 && runningReplicas != null && replicaCount === runningReplicas) {
  ok(`REPLICA_COUNT=${replicaCount} matches ${runningReplicas} running replicas`);
} else if (replicaCount >= 1) {
  ok(`REPLICA_COUNT=${replicaCount} set`);
} else if (runningReplicas != null && runningReplicas > 1) {
  warn(`REPLICA_COUNT unset but ${runningReplicas} replicas running — UW/Polygon limiter math may overshoot`);
} else {
  ok("REPLICA_COUNT check skipped (single replica or unknown)");
}

// ── 5. Options / UW socket churn (socket-health primary; logs secondary) ─────
console.log("\n5. Socket churn (socket-health + production logs)");
if (skipCli) {
  if (cronSecret) {
    try {
      const { status, body } = await fetchJson("/api/cron/socket-health", {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const opt = body?.websockets?.options;
      if (status === 200 && opt?.ok) ok(`options-socket (socket-health): ${opt.detail ?? "ok"}`);
      else if (status === 200 && opt) warn(`options-socket (socket-health): ${opt.detail ?? "not ok"}`);
      else warn(`socket-health probe HTTP ${status}`);
    } catch (e) {
      warn(`socket-health probe failed: ${e.message}`);
    }
  } else {
    warn("Production log checks skipped (no CRON_SECRET)");
  }
} else {
  // Live probe beats log tail: multi-replica clusters + off-hours standdown leave stale
  // 1006 lines in the last 30 log rows even when options.ok is true.
  let socketHealthOk = false;
  const cron = resolveCronSecret();
  if (cron) {
    try {
      const { status, body } = await fetchJson("/api/cron/socket-health", {
        headers: { Authorization: `Bearer ${cron}` },
      });
      const opt = body?.websockets?.options;
      if (status === 200 && opt?.ok) {
        socketHealthOk = true;
        ok(`options-socket (socket-health): ${opt.detail ?? "ok"}`);
      } else if (status === 200 && opt) {
        fail(`options-socket (socket-health): ${opt.detail ?? "not ok"}`);
      } else {
        warn(`socket-health probe HTTP ${status}`);
      }
    } catch (e) {
      warn(`socket-health probe failed: ${e.message}`);
    }
  } else {
    warn("CRON_SECRET unset — socket-health probe skipped (log grep only)");
  }

  try {
    const logs = sh("railway logs --service blackout-web 2>/dev/null | rg 'options-socket|uw-socket' | tail -30");
    const opt1006 = logs.match(/options-socket.*1006.*failures=(\d+)/g) || [];
    const lastFail = opt1006.length
      ? Number(opt1006[opt1006.length - 1].match(/failures=(\d+)/)?.[1] ?? 0)
      : 0;
    const optAuth = /options-socket.*authenticated/.test(logs);

    if (socketHealthOk) {
      if (lastFail >= 10) {
        warn(`options-socket log tail failures=${lastFail} (socket-health ok — stale pre-standdown)`);
      } else if (lastFail > 0) {
        warn(`options-socket recent 1006 failures=${lastFail} in logs (socket-health ok)`);
      }
    } else if (lastFail >= 10) {
      fail(`options-socket 1006 loop — failures=${lastFail} (Night's Watch marks may degrade)`);
    } else if (lastFail > 0) {
      warn(`options-socket recent 1006 failures=${lastFail}`);
    } else if (optAuth) {
      ok("options-socket authenticated in recent logs");
    } else {
      warn("options-socket: no recent authenticated line (may be off-hours or disabled)");
    }

    if (/uw-socket.*stall watchdog/i.test(logs)) warn("uw-socket stall reconnects in recent logs");
    else ok("No uw-socket stall storms in recent logs");
  } catch {
    warn("Could not read production logs");
  }
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
