#!/usr/bin/env node

/**
 * Vector performance audit (UNKNOWN #6)
 *
 * Collects metrics during RTH (09:30–16:00 ET):
 * - Cache hit rate (target: ≥80%)
 * - Universe snapshot staleness (target: ≤5 min declared)
 * - SSE frame latency P50/P95 (target: <100ms/<200ms)
 *
 * Run during entire RTH window, collect samples every 5s, analyze post-RTH.
 *
 * Requires instrumentation in:
 * - fetchVectorFullState (cache hit/miss logging)
 * - buildVectorStreamPayload (latency timing)
 */

import fs from 'fs';
import { resolveAuditBase } from './lib/audit-base.mjs';

const args = process.argv.slice(2);
const flags = {
  json: args.includes('--json'),
  quiet: args.includes('--quiet'),
  out: args.find(a => a.startsWith('--out='))?.split('=')[1] || './vector-perf-samples.jsonl',
  interval: parseInt(args.find(a => a.startsWith('--interval='))?.split('=')[1] || '5000'),
  duration: parseInt(args.find(a => a.startsWith('--duration='))?.split('=')[1] || '21600000'), // 6 hours
  base: resolveAuditBase(args.find(a => a.startsWith('--base='))?.split('=')[1]),
};

const log = (msg, level = 'INFO') => {
  if (flags.quiet && level === 'INFO') return;
  console.log(`[${level}] ${msg}`);
};

let sampleCount = 0;
const samples = [];

(async () => {
  log('Vector performance audit — metric collection phase', 'AUDIT');
  log(`Collecting samples every ${flags.interval}ms for ${flags.duration}ms (${(flags.duration / 3600000).toFixed(1)} hours)`, 'INFO');
  log(`Output: ${flags.out}`, 'INFO');

  const startTime = Date.now();
  const stream = fs.createWriteStream(flags.out, { flags: 'a' });

  const collector = async () => {
    const now = Date.now();
    const elapsed = now - startTime;

    if (elapsed > flags.duration) {
      log(`Collection complete after ${(elapsed / 1000).toFixed(0)}s, ${sampleCount} samples`, 'PASS');
      stream.end();
      process.exit(0);
    }

    try {
      // Fetch metrics from /api/market/vector/metrics (hypothetical endpoint)
      // In real implementation, this would be an actual instrumented endpoint
      const metricsRes = await fetch(`${flags.base}/api/market/vector/metrics`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (metricsRes && metricsRes.ok) {
        const metrics = await metricsRes.json();
        const sample = {
          timestamp: new Date().toISOString(),
          elapsed_ms: elapsed,
          cache_hit_rate: metrics.cache?.hit_rate || null,
          universe_age_ms: metrics.universe?.age_ms || null,
          sse_latency_p50_ms: metrics.sse?.p50_ms || null,
          sse_latency_p95_ms: metrics.sse?.p95_ms || null,
        };

        stream.write(JSON.stringify(sample) + '\n');
        samples.push(sample);
        sampleCount++;

        if (!flags.quiet && sampleCount % 12 === 0) { // Log every 60s at 5s interval
          log(`Sample ${sampleCount}: cache=${sample.cache_hit_rate}, sse_p50=${sample.sse_latency_p50_ms}ms`, 'INFO');
        }
      } else {
        log(`Metrics endpoint unavailable (${metricsRes?.status || 'no response'})`, 'WARN');
      }
    } catch (err) {
      log(`Collection error: ${err.message}`, 'WARN');
    }

    // Schedule next collection
    setTimeout(collector, flags.interval);
  };

  // Start collection
  collector();
})();
