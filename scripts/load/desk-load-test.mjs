#!/usr/bin/env node
/**
 * SPX desk load test — simulates N concurrent desk users hitting the same API
 * pattern the dashboard uses (pulse + flow + desk in parallel per tick).
 *
 * Usage:
 *   node scripts/load/desk-load-test.mjs
 *   node scripts/load/desk-load-test.mjs --tiers=300,500,1000
 *   LOAD_APP_URL=https://blackouttrades.com node scripts/load/desk-load-test.mjs
 *
 * Auth: one temp premium Clerk session (shared across virtual users) — tests
 * server/cache/DB capacity, not Clerk sign-in throughput.
 *
 * Env: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (same as audit scripts)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mintClerkPremiumSession } from "../audit/lib/prod-clerk-session.mjs";
import { generateDefaultAuditPhone } from "../audit/lib/audit-phone.mjs";

const APP = process.env.LOAD_APP_URL || "https://blackouttrades.com";
const COOLDOWN_MS = Number(process.env.LOAD_COOLDOWN_MS || 15_000);
const BASELINE_CYCLES = Number(process.env.LOAD_BASELINE_CYCLES || 10);

const tiersArg = process.argv.find((a) => a.startsWith("--tiers="));
const TIERS = tiersArg
  ? tiersArg
      .slice("--tiers=".length)
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  : [300, 500, 1000];

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeLatencies(msList) {
  const sorted = [...msList].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    p99: pct(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    avg: sorted.length ? Math.round(sum / sorted.length) : 0,
  };
}

async function timedFetch(path, cookie) {
  const url = `${APP}${path}`;
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      headers: { Cookie: cookie, Accept: "application/json" },
      cache: "no-store",
    });
    const ms = performance.now() - t0;
    let bodyOk = false;
    try {
      await res.json();
      bodyOk = true;
    } catch {
      bodyOk = false;
    }
    return {
      path,
      status: res.status,
      ms,
      ok: res.ok && bodyOk,
      error: null,
    };
  } catch (err) {
    return {
      path,
      status: 0,
      ms: performance.now() - t0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function deskPollTick(cookie) {
  return Promise.all([
    timedFetch("/api/market/spx/pulse", cookie),
    timedFetch("/api/market/spx/flow", cookie),
    timedFetch("/api/market/spx/desk", cookie),
  ]);
}

async function bootstrapOnce(cookie) {
  return timedFetch("/api/market/spx/bootstrap", cookie);
}

async function runBaseline(cookie) {
  console.log("\n── Baseline (single user, sequential) ──");
  const endpoints = [
    "/api/market/spx/bootstrap",
    "/api/market/spx/pulse",
    "/api/market/spx/flow",
    "/api/market/spx/desk",
  ];
  const byPath = Object.fromEntries(endpoints.map((p) => [p, []]));

  for (let i = 0; i < BASELINE_CYCLES; i++) {
    for (const path of endpoints) {
      const r = await timedFetch(path, cookie);
      byPath[path].push(r.ms);
      if (!r.ok) console.warn(`  baseline warn: ${path} status=${r.status} ${r.error ?? ""}`);
    }
  }

  const summary = {};
  for (const path of endpoints) {
    summary[path] = summarizeLatencies(byPath[path]);
    const s = summary[path];
    console.log(
      `  ${path}: p50=${Math.round(s.p50)}ms p95=${Math.round(s.p95)}ms max=${Math.round(s.max)}ms (n=${s.n})`
    );
  }

  console.log("\n── Baseline (single user, one parallel desk tick ×10) ──");
  const parallelMs = [];
  for (let i = 0; i < BASELINE_CYCLES; i++) {
    const t0 = performance.now();
    const tick = await deskPollTick(cookie);
    parallelMs.push(performance.now() - t0);
    if (tick.some((r) => !r.ok)) {
      console.warn(`  parallel tick ${i + 1}: ${tick.map((r) => `${r.path.split("/").pop()}=${r.status}`).join(" ")}`);
    }
  }
  const par = summarizeLatencies(parallelMs);
  console.log(
    `  parallel tick wall: p50=${Math.round(par.p50)}ms p95=${Math.round(par.p95)}ms max=${Math.round(par.max)}ms`
  );

  return { sequential: summary, parallelTick: par };
}

async function runTier(concurrency, cookie) {
  console.log(`\n── Load tier: ${concurrency} concurrent virtual users ──`);
  console.log(`  firing ${concurrency * 3} requests (${concurrency} × pulse+flow+desk)...`);

  const wallStart = performance.now();
  const batches = await Promise.all(
    Array.from({ length: concurrency }, async (_, i) => {
      if (i === 0 && concurrency >= 50) {
        // First VU also hits bootstrap (first paint)
        await bootstrapOnce(cookie);
      }
      return deskPollTick(cookie);
    })
  );
  const wallMs = performance.now() - wallStart;

  const flat = batches.flat();
  const byEndpoint = {
    pulse: [],
    flow: [],
    desk: [],
  };
  let errors = 0;
  let slow502 = 0;
  let rateLimited = 0;
  const statusCounts = {};

  for (const r of flat) {
    const key = r.path.includes("/pulse")
      ? "pulse"
      : r.path.includes("/flow")
        ? "flow"
        : "desk";
    byEndpoint[key].push(r.ms);
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    if (!r.ok) errors++;
    if (r.status === 502 || r.status === 503) slow502++;
    if (r.status === 429) rateLimited++;
  }

  const endpointStats = {};
  for (const [k, ms] of Object.entries(byEndpoint)) {
    endpointStats[k] = summarizeLatencies(ms);
  }

  const allMs = flat.map((r) => r.ms);
  const overall = summarizeLatencies(allMs);

  console.log(`  wall time: ${Math.round(wallMs)}ms`);
  console.log(
    `  all requests: p50=${Math.round(overall.p50)}ms p95=${Math.round(overall.p95)}ms p99=${Math.round(overall.p99)}ms max=${Math.round(overall.max)}ms`
  );
  for (const [k, s] of Object.entries(endpointStats)) {
    console.log(`  ${k}: p50=${Math.round(s.p50)}ms p95=${Math.round(s.p95)}ms max=${Math.round(s.max)}ms`);
  }
  console.log(
    `  errors=${errors}/${flat.length} (502/503=${slow502} 429=${rateLimited}) throughput=${Math.round((flat.length / wallMs) * 1000)} req/s`
  );
  console.log(`  status codes: ${JSON.stringify(statusCounts)}`);

  return {
    concurrency,
    wallMs,
    requests: flat.length,
    errors,
    status502503: slow502,
    status429: rateLimited,
    statusCounts,
    throughputRps: (flat.length / wallMs) * 1000,
    overall,
    endpoints: endpointStats,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\n=== SPX desk load test ===`);
  console.log(`Target: ${APP}`);
  console.log(`Tiers: ${TIERS.join(", ")}`);
  console.log(`Cooldown between tiers: ${COOLDOWN_MS}ms\n`);

  process.env.AUDIT_PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
  process.env.AUDIT_EMAIL = process.env.AUDIT_EMAIL || `desk-load-${Date.now()}@blackouttrades.com`;

  const auth = await mintClerkPremiumSession({ appUrl: APP });
  if (auth.skip) {
    console.error(`Auth skip: ${auth.reason}`);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const report = { app: APP, startedAt, tiers: TIERS, baseline: null, results: [] };

  try {
    report.baseline = await runBaseline(auth.cookieHeader);

    for (let i = 0; i < TIERS.length; i++) {
      if (i > 0) {
        console.log(`\n  (cooldown ${COOLDOWN_MS / 1000}s…)`);
        await sleep(COOLDOWN_MS);
      }
      report.results.push(await runTier(TIERS[i], auth.cookieHeader));
    }
  } finally {
    await auth.cleanup();
  }

  report.finishedAt = new Date().toISOString();
  const outDir = process.env.LOAD_OUT || join(process.cwd(), "audit-output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `desk-load-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${outPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
