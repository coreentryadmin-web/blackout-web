#!/usr/bin/env node
/**
 * Burst latency probe — N rounds across production hot paths.
 *
 * Was "staging vs prod". Two independent dead dependencies made every run of this
 * npm-wired script (`validate:latency-burst`) fail before probing anything:
 *   - `loadStagingCron()` read Secrets Manager's `blackout-staging/app/env`, which no longer
 *     exists — the whole `blackout-staging-*` stack was permanently decommissioned 2026-07-25
 *     (CLAUDE.md: "Do NOT reference the deleted blackout-staging-* stack or
 *     staging.blackouttrades.com"), confirmed live via `secretsmanager.describe_secret` ->
 *     ResourceNotFoundException.
 *   - `loadProdCron()` shelled out to the `railway` CLI, a tool this project stopped using when
 *     infra moved to AWS ECS — dead on any machine without it installed for this purpose (it does
 *     fall back to `process.env.CRON_SECRET` on failure, so this half was latent rather than
 *     fatal, but it is still a reference to infrastructure that no longer runs this app).
 * Production is the only environment now; this is a single-target burst probe against it, reading
 * CRON_SECRET from the environment the way every other current audit script does.
 *
 * Usage: CRON_SECRET=... node scripts/latency-burst-audit.mjs [--rounds=5]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { isDeployCacheWarmAllowed } from "./lib/cache-warm-deploy-gate.mjs";

const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? 5);
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const PATHS = [
  "/api/ready",
  "/api/market/spx/bootstrap",
  "/api/market/spx/desk",
  "/api/market/spx/pulse",
  "/api/market/spx/play",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/flows?limit=20",
  "/api/market/zerodte/board",
  "/api/market/regime",
  "/api/market/vector/universe",
];

async function warm(base, cron) {
  if (!isDeployCacheWarmAllowed()) {
    console.warn(
      "Outside ET extended warm window (weekday 4 AM–8 PM) — skipping force=1 cache warmers " +
        "(prevents off-hours desk-warm storms from concurrent audit runs, see #4013/#4017)"
    );
  } else {
    for (const p of ["/api/cron/desk-warm?force=1", "/api/cron/heatmap-warm?force=1"]) {
      try {
        await fetchRetry(`${base}${p}`, { headers: { Authorization: `Bearer ${cron}` } }, { retries: 2, timeoutMs: 180_000 });
      } catch {
        /* best-effort */
      }
    }
  }
  for (const path of PATHS) {
    try {
      await fetchRetry(`${base}${path}`, { headers: { Authorization: `Bearer ${cron}` } }, { retries: 1, timeoutMs: 60_000 });
    } catch {
      /* seed */
    }
  }
}

async function probe(base, cron, path) {
  const t0 = performance.now();
  const res = await fetchRetry(
    `${base}${path}`,
    { headers: { Authorization: `Bearer ${cron}`, Accept: "application/json" } },
    { retries: 1, timeoutMs: 90_000 }
  );
  await res.text();
  return { status: res.status, ms: Math.round(performance.now() - t0) };
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] ?? 0;
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    p50: p(0.5),
    p95: p(0.95),
    max: sorted[sorted.length - 1] ?? 0,
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)),
  };
}

async function runEnv(label, base, cron) {
  console.log(`\n=== ${label} (${ROUNDS} rounds) ===\n`);
  await warm(base, cron);
  const byPath = Object.fromEntries(PATHS.map((p) => [p, []]));
  for (let r = 1; r <= ROUNDS; r++) {
    for (const path of PATHS) {
      try {
        const { status, ms } = await probe(base, cron, path);
        byPath[path].push(ms);
        const g = ms <= 800 ? "PASS" : ms <= 2000 ? "WARN" : "FAIL";
        console.log(`  r${r} [${g}] ${path} — ${status} (${ms}ms)`);
      } catch (e) {
        console.log(`  r${r} [FAIL] ${path} — ${e.message}`);
        byPath[path].push(9999);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const summary = PATHS.map((path) => ({ path, ...stats(byPath[path]) }));
  console.log(`\n--- ${label} summary ---`);
  for (const row of summary) {
    console.log(`  ${row.path.padEnd(42)} p50=${String(row.p50).padStart(4)}ms p95=${String(row.p95).padStart(4)}ms max=${row.max}ms`);
  }
  return summary;
}

async function main() {
  const prodCron = process.env.CRON_SECRET?.trim();
  if (!prodCron) {
    console.error("Need CRON_SECRET for prod");
    process.exit(1);
  }
  const prod = await runEnv("PRODUCTION", "https://blackouttrades.com", prodCron);

  const report = { ts: new Date().toISOString(), rounds: ROUNDS, prod };
  const outPath = join(OUT, `latency-burst-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
