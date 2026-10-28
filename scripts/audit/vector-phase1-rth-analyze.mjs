#!/usr/bin/env node
/**
 * Vector-Pick-Sweep Phase 1 Validation Analysis
 *
 * Post-RTH analysis of monitoring data.
 * Compares collected metrics against Phase 1 targets and Phase 0 baseline.
 *
 * Usage:
 *   node scripts/audit/vector-phase1-rth-analyze.mjs \
 *     --data=/tmp/phase1-monitor.jsonl \
 *     --json
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PHASE1_TARGETS = {
  'vector-pick-sweep': {
    elapsed_ms_max: 180000,
    queue_wait_ms_p95: 5000,
    baseline_max: 793000,
    description: 'Max concurrent UW calls reduced from 164→~43 via concurrency=2'
  },
  'vector-dark-pool-warm': {
    success_rate_min: 50,
    baseline_variance: '1.8%-60%',
    description: 'Stable high success rate (was volatile)'
  },
  'vector-full-state-snapshot': {
    description: 'Baseline (no change expected, but monitor for queue waits)'
  }
};

async function parseMonitoringData(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content
      .trim()
      .split('\n')
      .map((line, idx) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          console.error(`Line ${idx + 1} parse error:`, err.message);
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    process.exit(1);
  }
}

function analyzeMetrics(data) {
  const analysis = {
    total_samples: data.length,
    timestamp_range: data.length > 0 ? {
      start: data[0].timestamp,
      end: data[data.length - 1].timestamp
    } : null,
    cron_stats: {}
  };

  const cronNames = ['vector-pick-sweep', 'vector-dark-pool-warm', 'vector-full-state-snapshot'];

  cronNames.forEach(cronName => {
    const samples = data.map(d => d.phase1_crons?.[cronName]).filter(Boolean);
    if (samples.length === 0) return;

    const elapsedMs = samples.map(s => s.elapsed_ms).filter(Boolean);
    const successRates = samples
      .map(s => {
        if (s.success_count && s.total_count) {
          return (s.success_count / s.total_count * 100);
        }
        return null;
      })
      .filter(Boolean);

    const stats = {
      samples: samples.length,
      last_status: samples[samples.length - 1].last_status,
      runs_24h: samples[samples.length - 1].runs_24h
    };

    if (elapsedMs.length > 0) {
      stats.elapsed_ms = {
        min: Math.min(...elapsedMs),
        max: Math.max(...elapsedMs),
        avg: (elapsedMs.reduce((a, b) => a + b, 0) / elapsedMs.length).toFixed(0),
        p95: percentile(elapsedMs, 0.95),
        samples: elapsedMs.length
      };
    }

    if (successRates.length > 0) {
      stats.success_rate = {
        min: Math.min(...successRates).toFixed(1),
        max: Math.max(...successRates).toFixed(1),
        avg: (successRates.reduce((a, b) => a + b, 0) / successRates.length).toFixed(1),
        samples: successRates.length
      };
    }

    analysis.cron_stats[cronName] = stats;
  });

  return analysis;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[idx];
}

function validatePhase1(analysis) {
  const verdict = {
    passed: true,
    findings: []
  };

  const pickSweep = analysis.cron_stats['vector-pick-sweep'];
  if (pickSweep?.elapsed_ms) {
    const target = PHASE1_TARGETS['vector-pick-sweep'].elapsed_ms_max;
    const baseline = PHASE1_TARGETS['vector-pick-sweep'].baseline_max;

    if (pickSweep.elapsed_ms.max > target) {
      verdict.passed = false;
      verdict.findings.push({
        severity: 'HIGH',
        metric: 'vector-pick-sweep elapsed time',
        value: `${pickSweep.elapsed_ms.max}ms`,
        target: `<${target}ms`,
        baseline: `${baseline}ms (pre-Phase1)`,
        improvement: `${((baseline - pickSweep.elapsed_ms.max) / baseline * 100).toFixed(1)}%`
      });
    } else {
      verdict.findings.push({
        severity: 'PASS',
        metric: 'vector-pick-sweep elapsed time',
        value: `${pickSweep.elapsed_ms.max}ms`,
        target: `<${target}ms`,
        improvement: `${((baseline - pickSweep.elapsed_ms.max) / baseline * 100).toFixed(1)}%`
      });
    }
  }

  const darkPool = analysis.cron_stats['vector-dark-pool-warm'];
  if (darkPool?.success_rate) {
    const target = PHASE1_TARGETS['vector-dark-pool-warm'].success_rate_min;
    const avg = parseFloat(darkPool.success_rate.avg);

    if (avg < target) {
      verdict.passed = false;
      verdict.findings.push({
        severity: 'HIGH',
        metric: 'vector-dark-pool-warm success rate (avg)',
        value: `${avg}%`,
        target: `>=${target}%`
      });
    } else {
      verdict.findings.push({
        severity: 'PASS',
        metric: 'vector-dark-pool-warm success rate (avg)',
        value: `${avg}% (min ${darkPool.success_rate.min}%, max ${darkPool.success_rate.max}%)`
      });
    }
  }

  return verdict;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map(arg => {
      const [k, v] = arg.split('=');
      return [k.replace(/^--/, ''), v];
    })
  );

  const dataPath = args.data || '/tmp/phase1-monitor.jsonl';
  const json = args.json === 'true' || args.json === '1';

  const data = await parseMonitoringData(resolve(dataPath));
  const analysis = analyzeMetrics(data);
  const verdict = validatePhase1(analysis);

  if (json) {
    console.log(JSON.stringify({ analysis, verdict }, null, 2));
  } else {
    console.log('\n=== PHASE 1 VALIDATION ANALYSIS ===\n');
    console.log(`Samples analyzed: ${analysis.total_samples}`);
    if (analysis.timestamp_range) {
      console.log(`Time range: ${analysis.timestamp_range.start} to ${analysis.timestamp_range.end}`);
    }
    console.log(`\nVerdict: ${verdict.passed ? '✅ PASSED' : '❌ FAILED'}`);

    console.log('\n--- Findings ---');
    verdict.findings.forEach(f => {
      const icon = f.severity === 'PASS' ? '✅' : f.severity === 'HIGH' ? '❌' : '⚠️';
      console.log(`\n${icon} ${f.metric}`);
      console.log(`   Value:  ${f.value}`);
      console.log(`   Target: ${f.target}`);
      if (f.baseline) console.log(`   Baseline: ${f.baseline}`);
      if (f.improvement) console.log(`   Improvement: ${f.improvement}`);
    });

    console.log('\n--- Cron Statistics ---');
    Object.entries(analysis.cron_stats).forEach(([cronName, stats]) => {
      console.log(`\n${cronName}:`);
      console.log(`  Samples: ${stats.samples}`);
      console.log(`  Last status: ${stats.last_status}`);
      if (stats.elapsed_ms) {
        console.log(`  Elapsed time: min=${stats.elapsed_ms.min}ms avg=${stats.elapsed_ms.avg}ms p95=${stats.elapsed_ms.p95}ms max=${stats.elapsed_ms.max}ms`);
      }
      if (stats.success_rate) {
        console.log(`  Success rate: min=${stats.success_rate.min}% avg=${stats.success_rate.avg}% max=${stats.success_rate.max}%`);
      }
      if (stats.runs_24h) {
        console.log(`  Runs (24h): ok=${stats.runs_24h.ok} skipped=${stats.runs_24h.skipped}`);
      }
    });

    if (!verdict.passed) {
      console.log('\n❌ Phase 1 targets NOT MET. See findings above.');
      process.exit(1);
    } else {
      console.log('\n✅ Phase 1 validation PASSED. Metrics within target bounds.');
    }
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
