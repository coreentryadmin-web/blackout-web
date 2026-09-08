#!/usr/bin/env node
/**
 * Production API latency snapshot (cron-authenticated paths).
 *
 * Was "staging vs production" — the entire `blackout-staging-*` stack (ECS, RDS, Secrets
 * Manager's `blackout-staging/app/env`, the `staging.blackouttrades.com` DNS) was permanently
 * decommissioned 2026-07-25 (see CLAUDE.md: "Do NOT reference the deleted blackout-staging-*
 * stack or staging.blackouttrades.com"). `loadStagingCron()`'s `aws secretsmanager
 * get-secret-value --secret-id blackout-staging/app/env` throws `ResourceNotFoundException`
 * unconditionally now (confirmed live via `secretsmanager.describe_secret`), so every call to
 * this script died before probing anything — dead tooling wired to a live `npm run
 * validate:latency-compare`. Production is the only environment; this is now a single-target
 * latency snapshot against it, using the CRON_SECRET env var every other current audit script
 * already reads this way (data-validator.mjs, zerodte-e2e-suite.mjs, etc.).
 *
 * Usage: CRON_SECRET=... node scripts/compare-latency-envs.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { isDeployCacheWarmAllowed } from "./lib/cache-warm-deploy-gate.mjs";

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const PATHS = [
  "/api/health",
  "/api/ready",
  "/api/market/spx/bootstrap",
  "/api/market/spx/desk",
  "/api/market/spx/pulse",
  "/api/market/flows?limit=20",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/gex-heatmap?ticker=NVDA",
  "/api/market/gex-heatmap?ticker=QQQ",
  "/api/market/nighthawk/edition",
  "/api/market/zerodte/board",
  "/api/market/vector/universe",
  "/api/market/regime",
];

async function probe(base, cronSecret, path) {
  const t0 = performance.now();
  try {
    const res = await fetchRetry(
      `${base}${path}`,
      { headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" } },
      { retries: 4, baseDelayMs: 1500, timeoutMs: 90_000 }
    );
    await res.text();
    return { status: res.status, ms: Math.round(performance.now() - t0), ok: res.status < 500 };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), ok: false, err: e.message };
  }
}

async function warmCaches(base, cronSecret) {
  if (!isDeployCacheWarmAllowed()) {
    console.log(
      "  (outside ET extended warm window (weekday 4 AM–8 PM) — skipping force=1 cache warmers, " +
        "prevents off-hours desk-warm storms from concurrent audit runs, see #4013/#4017)"
    );
    return;
  }
  const paths = [
    "/api/cron/desk-warm?force=1",
    "/api/cron/heatmap-warm?force=1",
    "/api/cron/zerodte-warm?force=1",
  ];
  console.log("  (warming caches via cron…)");
  for (const path of paths) {
    try {
      const res = await fetchRetry(
        `${base}${path}`,
        { headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" } },
        { retries: 3, baseDelayMs: 1200, timeoutMs: 180_000 }
      );
      await res.text();
    } catch {
      /* best-effort */
    }
  }
}

async function runEnv(label, base, cronSecret) {
  console.log(`\n=== ${label} (${base}) ===\n`);
  await warmCaches(base, cronSecret);
  // Seed once (3 ECS replicas / multi-instance → first measured hit may still be cold).
  for (const path of PATHS) {
    try {
      const res = await fetchRetry(
        `${base}${path}`,
        { headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" } },
        { retries: 2, baseDelayMs: 800, timeoutMs: 90_000 }
      );
      await res.text();
    } catch {
      /* seed best-effort */
    }
  }
  // Extra seeds for heatmap + ready (multi-replica cold starts).
  const heatmapPaths = PATHS.filter((p) => p.includes("gex-heatmap"));
  const readyPaths = ["/api/health", "/api/ready"];
  for (let i = 0; i < 2; i++) {
    for (const path of [...readyPaths, ...heatmapPaths]) {
      try {
        const res = await fetchRetry(
          `${base}${path}`,
          { headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" } },
          { retries: 2, baseDelayMs: 600, timeoutMs: 90_000 }
        );
        await res.text();
      } catch {
        /* seed best-effort */
      }
    }
  }
  const rows = [];
  for (const path of PATHS) {
    const r = await probe(base, cronSecret, path);
    const grade = r.ms <= 800 ? "PASS" : r.ms <= 2000 ? "WARN" : "FAIL";
    if (!r.ok) rows.push({ path, ...r, grade: "FAIL" });
    else rows.push({ path, ...r, grade });
    console.log(`  [${r.ok ? grade : "FAIL"}] ${path} — ${r.status || "ERR"} (${r.ms}ms)`);
  }
  return rows;
}

async function main() {
  const prodCron = process.env.CRON_SECRET?.trim();
  if (!prodCron) {
    console.error("prod CRON_SECRET env missing — set CRON_SECRET env var");
    process.exit(1);
  }

  const prod = await runEnv("PRODUCTION", "https://blackouttrades.com", prodCron);

  const fails = prod.filter((r) => r.grade === "FAIL");
  const report = {
    ts: new Date().toISOString(),
    prod,
    prod_failures: fails.length,
  };
  const outPath = join(OUT, `latency-compare-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${outPath}`);
  console.log(`Prod FAIL count: ${fails.length}`);
  if (fails.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
