#!/usr/bin/env node

/**
 * Vector pivot-play scenario drill
 *
 * Tests all 4 committed pivot scenarios:
 * 1. Uncommitted pivot (spot on gammaFlip)
 * 2. Committed long (spot > gammaFlip + PIVOT_PICK_COMMIT_EPS)
 * 3. Committed short (spot < gammaFlip - PIVOT_PICK_COMMIT_EPS)
 * 4. Reversal (spot crosses gammaFlip again)
 *
 * First phase: offline logic verification
 * Second phase: live RTH validation against /vector API
 */

const args = process.argv.slice(2);
const flags = {
  json: args.includes('--json'),
  quiet: args.includes('--quiet'),
  live: args.includes('--live'),
  base: args.find(a => a.startsWith('--base='))?.split('=')[1] || 'https://blackouttrades.com',
};

const log = (msg, level = 'INFO') => {
  if (flags.quiet && level === 'INFO') return;
  console.log(`[${level}] ${msg}`);
};

let passed = 0;
let failed = 0;
const findings = [];

const PIVOT_PICK_COMMIT_EPS = 0.001; // 0.1% threshold

/**
 * effectivePickBias — the same logic as in vector-play-candidates.ts
 * @param play - Object with bias, spot, gammaFlip
 * @returns "long" | "short" | null (uncommitted)
 */
const effectivePickBias = (play) => {
  if (play.bias !== 'neutral') {
    // Non-pivot: use raw bias
    return play.bias || null;
  }
  // Pivot play: derive from spot vs gammaFlip
  if (play.gammaFlip === null || play.gammaFlip === undefined) return null;

  const spotAboveFlip = play.spot > play.gammaFlip;
  const flipDelta = Math.abs(play.spot - play.gammaFlip) / play.gammaFlip;

  if (flipDelta <= PIVOT_PICK_COMMIT_EPS) {
    // Uncommitted: spot is ON the flip
    return null;
  }

  return spotAboveFlip ? 'long' : 'short';
};

log('Vector pivot-play scenario drill', 'AUDIT');

// ============================================================================
// PHASE 1: Offline Logic Tests
// ============================================================================

log('Phase 1: Offline logic verification', 'PHASE');

// Scenario 1: Uncommitted pivot
log('Scenario 1: Uncommitted pivot (spot on gammaFlip)', 'CHECK');
{
  const play = {
    bias: 'neutral',
    spot: 100.00,
    gammaFlip: 100.00,
  };
  const effective = effectivePickBias(play);
  if (effective === null) {
    passed++;
    if (!flags.quiet) log('  ✓ Effective bias is null (uncommitted)', 'PASS');
  } else {
    failed++;
    findings.push({
      scenario: 1,
      test: 'Uncommitted pivot',
      expected: 'null',
      got: effective,
      severity: 'P1',
    });
    log(`  ✗ Expected null, got ${effective}`, 'FAIL');
  }
}

// Scenario 2: Committed long
log('Scenario 2: Committed long (spot > gammaFlip + eps)', 'CHECK');
{
  const play = {
    bias: 'neutral',
    spot: 102.00, // 2% above flip
    gammaFlip: 100.00,
  };
  const effective = effectivePickBias(play);
  if (effective === 'long') {
    passed++;
    if (!flags.quiet) log('  ✓ Effective bias is "long"', 'PASS');
  } else {
    failed++;
    findings.push({
      scenario: 2,
      test: 'Committed long',
      expected: '"long"',
      got: effective,
      severity: 'P1',
    });
    log(`  ✗ Expected "long", got ${effective}`, 'FAIL');
  }
}

// Scenario 3: Committed short
log('Scenario 3: Committed short (spot < gammaFlip - eps)', 'CHECK');
{
  const play = {
    bias: 'neutral',
    spot: 98.00, // 2% below flip
    gammaFlip: 100.00,
  };
  const effective = effectivePickBias(play);
  if (effective === 'short') {
    passed++;
    if (!flags.quiet) log('  ✓ Effective bias is "short"', 'PASS');
  } else {
    failed++;
    findings.push({
      scenario: 3,
      test: 'Committed short',
      expected: '"short"',
      got: effective,
      severity: 'P1',
    });
    log(`  ✗ Expected "short", got ${effective}`, 'FAIL');
  }
}

// Scenario 4: Reversal
log('Scenario 4: Reversal (spot crosses flip, effective toggles)', 'CHECK');
{
  // Start: committed long
  const playLong = {
    bias: 'neutral',
    spot: 102.00,
    gammaFlip: 100.00,
  };
  const effectiveLong = effectivePickBias(playLong);

  // After reversal: spot moves back below flip
  const playShort = {
    bias: 'neutral',
    spot: 98.00,
    gammaFlip: 100.00,
  };
  const effectiveShort = effectivePickBias(playShort);

  if (effectiveLong === 'long' && effectiveShort === 'short') {
    passed++;
    if (!flags.quiet) log('  ✓ Effective bias toggles on reversal (long → short)', 'PASS');
  } else {
    failed++;
    findings.push({
      scenario: 4,
      test: 'Reversal toggle',
      expected: 'long → short',
      got: `${effectiveLong} → ${effectiveShort}`,
      severity: 'P1',
    });
    log(`  ✗ Expected long → short, got ${effectiveLong} → ${effectiveShort}`, 'FAIL');
  }
}

// ============================================================================
// PHASE 2: Live RTH validation (if --live flag)
// ============================================================================

if (flags.live) {
  log('Phase 2: Live RTH validation', 'PHASE');
  log('Live validation requires --live flag and running during RTH', 'INFO');
  // TODO: Implement live fetch + API validation when called with --live
  log('Live phase not implemented yet (requires next market open)', 'WARN');
}

// ============================================================================
// SUMMARY
// ============================================================================

log(`Offline drill complete: ${passed} pass, ${failed} fail`, failed === 0 ? 'PASS' : 'FAIL');

if (flags.json) {
  const output = {
    generated_at: new Date().toISOString(),
    audit: 'vector-pivot-scenario-drill',
    phase: 'offline-logic',
    results: {
      total: passed + failed,
      passed,
      failed,
      findings,
    },
    scenarios: {
      '1-uncommitted': findings.filter(f => f.scenario === 1).length === 0,
      '2-committed-long': findings.filter(f => f.scenario === 2).length === 0,
      '3-committed-short': findings.filter(f => f.scenario === 3).length === 0,
      '4-reversal': findings.filter(f => f.scenario === 4).length === 0,
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

process.exit(failed > 0 ? 1 : 0);
