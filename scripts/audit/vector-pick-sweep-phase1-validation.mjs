#!/usr/bin/env node
/**
 * Vector-Pick-Sweep Phase 1 Validation
 *
 * Measures runtime improvement of vector-pick-sweep after Phase 1 deployment (2026-10-06).
 * Compares against baseline measured on 2026-10-05 (before the fix):
 * - Baseline: 62-793s elapsed per invocation
 * - Baseline: 10-20s UW queue waits per call
 * - Baseline: vector-dark-pool-warm success rate fluctuating 1.8% → 0% → 60%
 *
 * Target post-Phase 1:
 * - vector-pick-sweep stays <180s (vs 793s peak observed)
 * - UW queue waits drop materially
 * - vector-dark-pool-warm success rate stabilizes and improves
 *
 * Measurements (from CloudWatch logs):
 * 1. vector-pick-sweep elapsed times during RTH window
 * 2. UW rate-limiter queue wait patterns
 * 3. vector-dark-pool-warm success rate across runs
 * 4. ALB TargetResponseTime (tail latency impact)
 *
 * Usage:
 *   node scripts/audit/vector-pick-sweep-phase1-validation.mjs [--days=N] [--now-et=HH:MM] [--json]
 *
 * Requires AWS access (CloudWatch Logs).
 */

import { spawn } from "child_process";
import { readFileSync } from "fs";

const LOG_GROUP = "/ecs/blackout-production";
const CRON_NAMES = ["vector-pick-sweep", "vector-dark-pool-warm", "vector-full-state-snapshot"];

/**
 * Convert ET time to minutes since midnight.
 */
function etTimeToMinutes(etHHMM) {
  if (!etHHMM || !etHHMM.includes(":")) return null;
  const [h, m] = etHHMM.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Parse CloudWatch log entries for cron timing data.
 * Looks for patterns like:
 *   - "vector-pick-sweep elapsed=123456ms"
 *   - "[uw] queue wait 15234ms"
 *   - "dark-pool-warm success 3/5"
 */
function parseLogEntry(line) {
  const cronMatch = line.match(/(vector-pick-sweep|vector-dark-pool-warm|vector-full-state-snapshot)/);
  const elapsedMatch = line.match(/elapsed=(\d+)ms/);
  const queueMatch = line.match(/queue wait[\s]*(\d+)ms/);
  const successMatch = line.match(/success[\s]*(\d+)\/(\d+)/);

  const entry = {};

  if (cronMatch) entry.cron = cronMatch[1];
  if (elapsedMatch) entry.elapsed_ms = Number(elapsedMatch[1]);
  if (queueMatch) entry.queue_wait_ms = Number(queueMatch[1]);
  if (successMatch) {
    entry.success_count = Number(successMatch[1]);
    entry.total_count = Number(successMatch[2]);
    entry.success_rate = (Number(successMatch[1]) / Number(successMatch[2]) * 100).toFixed(1);
  }

  return Object.keys(entry).length > 0 ? entry : null;
}

/**
 * Query CloudWatch logs for the RTH window.
 */
async function queryCloudWatchLogs(daysBack = 3, nowEt = null) {
  // Calculate ETH RTH window (09:30-16:00 ET = 13:30-20:00 UTC)
  // If nowEt is provided, use that specific time window

  const startTimeMs = Date.now() - daysBack * 86400 * 1000;
  const endTimeMs = Date.now();

  const filterPatterns = [
    `[..., cron_name, ..., elapsed=*ms]`,
    `[..., "queue wait", ms, ...]`,
    `[..., "success", count, "/", total, ...]`,
  ];

  console.log(`\n📊 Querying CloudWatch logs (${daysBack} days back)...`);
  console.log(`   Log group: ${LOG_GROUP}`);
  console.log(`   Time range: ${new Date(startTimeMs).toISOString()} to ${new Date(endTimeMs).toISOString()}`);

  // Since we don't have AWS CLI here, provide instructions instead
  console.log(`\n⚠️  AWS CLI not available in this sandbox.`);
  console.log(`\nTo validate Phase 1, run this AWS CLI command from your local machine:\n`);

  const cmd = `aws logs filter-log-events \\
  --log-group-name ${LOG_GROUP} \\
  --start-time ${startTimeMs} \\
  --end-time ${endTimeMs} \\
  --filter-pattern "[timestamp, ..., message]" \\
  --query 'events[?contains(message, \`elapsed=\`) || contains(message, \`queue wait\`) || contains(message, \`success\`)].[timestamp,message]' \\
  --region us-east-1 \\
  --output json > vector-pick-sweep-phase1-logs.json`;

  console.log(cmd);
  return null;
}

/**
 * Parse and summarize validation results.
 */
function summarizeResults(logs, options = {}) {
  if (!logs || !Array.isArray(logs)) {
    console.log(`\n❌ No logs provided. See instructions above to fetch logs from CloudWatch.`);
    return;
  }

  const entries = logs
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .map(parseLogEntry)
    .filter(Boolean);

  const byC = {};
  CRON_NAMES.forEach((c) => {
    byC[c] = entries.filter((e) => e.cron === c);
  });

  console.log(`\n📈 Validation Results:`);
  console.log(`   Total log entries parsed: ${entries.length}`);

  // Vector-pick-sweep metrics
  const pickSweepElapsed = byC["vector-pick-sweep"]
    .filter((e) => e.elapsed_ms)
    .map((e) => e.elapsed_ms);

  if (pickSweepElapsed.length > 0) {
    const sorted = pickSweepElapsed.sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const max = Math.max(...pickSweepElapsed);

    console.log(`\n🔹 vector-pick-sweep elapsed time (${pickSweepElapsed.length} invocations):`);
    console.log(`   p50: ${p50}ms (${(p50 / 1000).toFixed(1)}s)`);
    console.log(`   p95: ${p95}ms (${(p95 / 1000).toFixed(1)}s)`);
    console.log(`   max: ${max}ms (${(max / 1000).toFixed(1)}s)`);
    console.log(`   Baseline (2026-10-05): 62-793s`);
    console.log(`   Phase 1 target: <120s by +25min into RTH (Phase 1 crossing under 120s by 25 min in, verified live 2026-10-13)`);
    console.log(`   Status: ${max < 120000 ? "✅ PHASE 1 EFFECTIVE" : max < 180000 ? "⚠️  IMPROVED BUT ABOVE TARGET" : "⚠️  NEEDS INVESTIGATION"}`);
  } else {
    console.log(`\n🔹 vector-pick-sweep: No elapsed data found in logs`);
  }

  // UW queue wait metrics
  const queueWaits = entries
    .filter((e) => e.queue_wait_ms)
    .map((e) => e.queue_wait_ms);

  if (queueWaits.length > 0) {
    const sorted = queueWaits.sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const avg = queueWaits.reduce((a, b) => a + b, 0) / queueWaits.length;

    console.log(`\n🔹 UW rate-limiter queue waits (${queueWaits.length} observations):`);
    console.log(`   p50: ${p50}ms (${(p50 / 1000).toFixed(2)}s)`);
    console.log(`   p95: ${p95}ms (${(p95 / 1000).toFixed(2)}s)`);
    console.log(`   avg: ${avg.toFixed(0)}ms (${(avg / 1000).toFixed(2)}s)`);
    console.log(`   Baseline (2026-10-05): 10-20s`);
    console.log(`   Status: ${p95 < 15000 ? "✅ IMPROVED" : "⚠️  MONITOR"}`);
  } else {
    console.log(`\n🔹 UW queue waits: No data found in logs`);
  }

  // Vector-dark-pool-warm metrics
  const darkPoolSuccessRates = byC["vector-dark-pool-warm"]
    .filter((e) => e.success_rate)
    .map((e) => parseFloat(e.success_rate));

  if (darkPoolSuccessRates.length > 0) {
    const min = Math.min(...darkPoolSuccessRates);
    const max = Math.max(...darkPoolSuccessRates);
    const avg = darkPoolSuccessRates.reduce((a, b) => a + b, 0) / darkPoolSuccessRates.length;

    console.log(`\n🔹 vector-dark-pool-warm success rate (${darkPoolSuccessRates.length} runs):`);
    console.log(`   min: ${min.toFixed(1)}%`);
    console.log(`   max: ${max.toFixed(1)}%`);
    console.log(`   avg: ${avg.toFixed(1)}%`);
    console.log(`   Baseline (2026-10-05): 1.8% → 0% → 60% (high variance)`);
    console.log(`   Status: ${min > 50 && Math.abs(max - min) < 30 ? "✅ STABILIZED" : "⚠️  STILL VARIABLE"}`);
  } else {
    console.log(`\n🔹 vector-dark-pool-warm success rate: No data found in logs`);
  }

  // Conclusions
  console.log(`\n📋 Summary:`);
  console.log(
    `   Phase 1 effectiveness measured via: vector-pick-sweep runtime, UW queue waits, dark-pool-warm stability`
  );
  if (options.json) {
    return {
      cron: "vector-pick-sweep",
      phase: 1,
      measured_at_utc: new Date().toISOString(),
      baseline_2026_10_05: {
        pick_sweep_elapsed_range: "62-793s",
        uw_queue_wait_range: "10-20s",
        dark_pool_success_rate_variance: "1.8% → 0% → 60%",
      },
      current_metrics: {
        pick_sweep_elapsed: pickSweepElapsed.length > 0 ? { count: pickSweepElapsed.length, max_s: (Math.max(...pickSweepElapsed) / 1000).toFixed(1) } : null,
        queue_waits: queueWaits.length > 0 ? { count: queueWaits.length, p95_s: (queueWaits.sort((a, b) => a - b)[Math.floor(queueWaits.length * 0.95)] / 1000).toFixed(2) } : null,
        dark_pool_success_rates: darkPoolSuccessRates.length > 0 ? { count: darkPoolSuccessRates.length, variance: (Math.max(...darkPoolSuccessRates) - Math.min(...darkPoolSuccessRates)).toFixed(1) } : null,
      },
    };
  }
}

async function main() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.split("=");
    args[key.replace("--", "")] = value || true;
  });

  const daysBack = parseInt(args.days || "7", 10);
  const nowEt = args["now-et"] || null;
  const asJson = args.json === true || args.json === "true";

  console.log(`\n🔧 Vector-Pick-Sweep Phase 1 Validation`);
  console.log(`   Deployment: 2026-10-06 (PR #5592)`);
  console.log(`   Change: Added MAX_CONCURRENCY=2 to runUwPool() call`);
  console.log(`   Expected: Runtime drop from 793s peak toward 120-180s`);

  await queryCloudWatchLogs(daysBack, nowEt);

  // If logs were provided via stdin or a file, parse them
  if (process.stdin.isTTY === false) {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    try {
      const logs = JSON.parse(input);
      summarizeResults(logs, { json: asJson });
    } catch (e) {
      console.error("❌ Failed to parse input JSON:", e.message);
    }
  } else {
    console.log(`\n✅ Validation script ready.`);
    console.log(
      `Once logs are fetched, pipe them to this script:\n   cat vector-pick-sweep-phase1-logs.json | node ${process.argv[1]}`
    );
  }
}

main().catch(console.error);
