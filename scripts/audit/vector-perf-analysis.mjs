#!/usr/bin/env node

/**
 * Vector performance analysis
 *
 * Analyzes samples collected by vector-perf-audit.mjs:
 * - Aggregate cache hit rate (success: ≥80%)
 * - Universe staleness (success: ≤5 min)
 * - SSE latency P50/P95 (success: <100ms/<200ms)
 *
 * Input: JSONL file from vector-perf-audit.mjs
 */

import fs from 'fs';
import readline from 'readline';

const args = process.argv.slice(2);
const flags = {
  json: args.includes('--json'),
  quiet: args.includes('--quiet'),
  input: args.find(a => a.startsWith('--input='))?.split('=')[1] || './vector-perf-samples.jsonl',
};

const log = (msg, level = 'INFO') => {
  if (flags.quiet && level === 'INFO') return;
  console.log(`[${level}] ${msg}`);
};

const percentile = (arr, p) => {
  const sorted = arr.slice().sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
};

(async () => {
  log('Vector performance analysis', 'AUDIT');

  const samples = [];
  const lineReader = readline.createInterface({
    input: fs.createReadStream(flags.input),
  });

  // Parse JSONL samples
  for await (const line of lineReader) {
    if (line.trim()) {
      try {
        samples.push(JSON.parse(line));
      } catch (err) {
        log(`Parse error: ${err.message}`, 'WARN');
      }
    }
  }

  if (samples.length === 0) {
    log('No samples to analyze', 'WARN');
    process.exit(1);
  }

  log(`Analyzing ${samples.length} samples`, 'INFO');

  // Extract metrics
  const cacheRates = samples.filter(s => s.cache_hit_rate !== null).map(s => s.cache_hit_rate);
  const universeAges = samples.filter(s => s.universe_age_ms !== null).map(s => s.universe_age_ms);
  const sseLatenciesP50 = samples.filter(s => s.sse_latency_p50_ms !== null).map(s => s.sse_latency_p50_ms);
  const sseLatenciesP95 = samples.filter(s => s.sse_latency_p95_ms !== null).map(s => s.sse_latency_p95_ms);

  // Compute statistics
  const stats = {
    samples: samples.length,
    cache_hit_rate: {
      mean: cacheRates.length > 0 ? (cacheRates.reduce((a, b) => a + b) / cacheRates.length).toFixed(1) : null,
      target: '≥80%',
      samples: cacheRates.length,
    },
    universe_staleness_sec: {
      mean: universeAges.length > 0 ? ((universeAges.reduce((a, b) => a + b) / universeAges.length) / 1000).toFixed(1) : null,
      p95: universeAges.length > 0 ? (percentile(universeAges, 95) / 1000).toFixed(1) : null,
      target: '≤300s (5 min)',
      samples: universeAges.length,
    },
    sse_latency_p50_ms: {
      mean: sseLatenciesP50.length > 0 ? percentile(sseLatenciesP50, 50).toFixed(1) : null,
      target: '<100ms',
      samples: sseLatenciesP50.length,
    },
    sse_latency_p95_ms: {
      mean: sseLatenciesP95.length > 0 ? percentile(sseLatenciesP95, 95).toFixed(1) : null,
      target: '<200ms',
      samples: sseLatenciesP95.length,
    },
  };

  // Report
  log(`Cache hit rate: ${stats.cache_hit_rate.mean}% (target ${stats.cache_hit_rate.target}, ${cacheRates.length} samples)`,
    stats.cache_hit_rate.mean >= 80 ? 'PASS' : 'WARN');

  log(`Universe staleness (mean): ${stats.universe_staleness_sec.mean}s (target ${stats.universe_staleness_sec.target}, ${universeAges.length} samples)`,
    stats.universe_staleness_sec.mean <= 300 ? 'PASS' : 'WARN');

  log(`SSE latency P50: ${stats.sse_latency_p50_ms.mean}ms (target ${stats.sse_latency_p50_ms.target}, ${sseLatenciesP50.length} samples)`,
    stats.sse_latency_p50_ms.mean < 100 ? 'PASS' : 'WARN');

  log(`SSE latency P95: ${stats.sse_latency_p95_ms.mean}ms (target ${stats.sse_latency_p95_ms.target}, ${sseLatenciesP95.length} samples)`,
    stats.sse_latency_p95_ms.mean < 200 ? 'PASS' : 'WARN');

  if (flags.json) {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      analysis: 'vector-perf',
      stats,
      verdicts: {
        cache_hit_rate: stats.cache_hit_rate.mean >= 80 ? 'PASS' : 'FAIL',
        universe_staleness: stats.universe_staleness_sec.mean <= 300 ? 'PASS' : 'FAIL',
        sse_latency_p50: stats.sse_latency_p50_ms.mean < 100 ? 'PASS' : 'FAIL',
        sse_latency_p95: stats.sse_latency_p95_ms.mean < 200 ? 'PASS' : 'FAIL',
      },
    }, null, 2));
  }

  process.exit(0);
})();
