#!/usr/bin/env node
/**
 * Vector-Pick-Sweep Phase 1 RTH Monitoring
 *
 * Real-time cron health probe during RTH window.
 * Captures vector-pick-sweep performance to validate Phase 1 improvement (793s → <180s target).
 *
 * Usage:
 *   # Step 1: Mint temp admin session (outputs __session JWT)
 *   node scripts/audit/lib/clerk-audit-session.mjs --premium
 *
 *   # Step 2: Monitor during RTH (runs every 30min from :00 to :50)
 *   node scripts/audit/vector-phase1-rth-monitor.mjs \
 *     --base=https://blackouttrades.com \
 *     --cookie="__session=<JWT from step 1>" \
 *     --interval=30 \
 *     --json > /tmp/phase1-monitor.jsonl
 *
 *   # Step 3: Analyze results
 *   node scripts/audit/vector-phase1-rth-analyze.mjs \
 *     --data=/tmp/phase1-monitor.jsonl \
 *     --json
 *
 * Measurements captured:
 * - vector-pick-sweep: elapsed_ms, last_status, runs_24h
 * - vector-dark-pool-warm: success_rate, last_status
 * - vector-full-state-snapshot: elapsed_ms, queue_wait_ms
 * - ALB tail latency p99 (from CloudWatch if available)
 */

import fetch from 'node:fetch';
import { URL } from 'node:url';
import { writeFileSync } from 'node:fs';

const PHASE1_CRONS = [
  'vector-pick-sweep',
  'vector-dark-pool-warm',
  'vector-full-state-snapshot'
];

const PHASE1_BASELINE = {
  'vector-pick-sweep': {
    elapsed_ms_min: 62000,
    elapsed_ms_max: 793000,
    queue_wait_ms_p95: 20000,
    description: 'Peak 793s pre-Phase1, target <180s post-Phase1'
  },
  'vector-dark-pool-warm': {
    success_rate_baseline: '1.8-60%',
    description: 'Volatile (1.8%→0%→60%) pre-Phase1, target stable 50%+'
  },
  'vector-full-state-snapshot': {
    description: 'Largest fan-out (80 calls), contention driver'
  }
};

async function fetchCronHealth(base, cookie) {
  try {
    const url = new URL('/api/admin/cron-health', base);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Cookie': cookie,
        'User-Agent': 'phase1-rth-monitor'
      }
    });

    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }

    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

function extractPhase1Metrics(cronHealth) {
  const metrics = {
    timestamp: new Date().toISOString(),
    phase1_crons: {}
  };

  PHASE1_CRONS.forEach(cronName => {
    const cron = cronHealth[cronName];
    if (cron) {
      metrics.phase1_crons[cronName] = {
        last_status: cron.last_status,
        last_message: cron.last_message?.substring(0, 200),
        runs_24h: cron.runs_24h,
        // Extract elapsed_ms if present in last_message
        elapsed_ms: extractNumber(cron.last_message, /elapsed=(\d+)ms/),
        queue_wait_ms: extractNumber(cron.last_message, /queue wait[\s]*(\d+)ms/),
        success_count: extractNumber(cron.last_message, /success[\s]*(\d+)\/\d+/),
        total_count: extractNumber(cron.last_message, /success[\s]*\d+\/(\d+)/)
      };

      // Calculate success rate if present
      if (metrics.phase1_crons[cronName].success_count && metrics.phase1_crons[cronName].total_count) {
        metrics.phase1_crons[cronName].success_rate = (
          metrics.phase1_crons[cronName].success_count / metrics.phase1_crons[cronName].total_count * 100
        ).toFixed(1) + '%';
      }
    }
  });

  return metrics;
}

function extractNumber(text, pattern) {
  if (!text) return null;
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map(arg => {
      const [k, v] = arg.split('=');
      return [k.replace(/^--/, ''), v];
    })
  );

  const base = args.base || 'https://blackouttrades.com';
  const cookie = args.cookie || '';
  const interval = Number(args.interval || 30); // minutes
  const json = args.json === 'true' || args.json === '1';

  if (!cookie) {
    console.error('ERROR: --cookie required (format: __session=<JWT>)');
    console.error('Get it from: node scripts/audit/lib/clerk-audit-session.mjs --premium');
    process.exit(1);
  }

  console.error(`Starting Phase 1 monitoring (${interval}min intervals)`);
  console.error(`Baseline targets:`);
  Object.entries(PHASE1_BASELINE).forEach(([cron, info]) => {
    console.error(`  ${cron}: ${info.description}`);
  });
  console.error('');

  let iteration = 0;
  while (true) {
    iteration++;
    const health = await fetchCronHealth(base, cookie);
    const metrics = extractPhase1Metrics(health);

    if (json) {
      console.log(JSON.stringify(metrics));
    } else {
      console.error(`[${metrics.timestamp}] Iteration ${iteration}`);
      Object.entries(metrics.phase1_crons).forEach(([cronName, data]) => {
        console.error(`  ${cronName}:`);
        console.error(`    status: ${data.last_status}`);
        if (data.elapsed_ms) console.error(`    elapsed: ${data.elapsed_ms}ms`);
        if (data.success_rate) console.error(`    success_rate: ${data.success_rate}`);
        if (data.runs_24h) console.error(`    runs_24h: ok=${data.runs_24h.ok} skipped=${data.runs_24h.skipped}`);
      });
    }

    // Check Phase 1 targets
    const pickSweep = metrics.phase1_crons['vector-pick-sweep'];
    if (pickSweep && pickSweep.elapsed_ms && pickSweep.elapsed_ms > 180000) {
      console.error(`\n⚠️  WARNING: vector-pick-sweep ${pickSweep.elapsed_ms}ms > 180s target`);
    }

    // Sleep until next interval
    if (interval > 0) {
      await new Promise(resolve => setTimeout(resolve, interval * 60 * 1000));
    } else {
      break;
    }
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
