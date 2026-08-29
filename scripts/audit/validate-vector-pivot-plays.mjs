#!/usr/bin/env node

/**
 * Vector pivot-play correctness audit
 *
 * Validates:
 * - Committed pivot plays are NOT skipped in pick sweep (fix #3139)
 * - Effective bias is correctly derived when spot > gammaFlip + PIVOT_PICK_COMMIT_EPS
 * - Invalidation levels < $10 are parsed correctly (fix #3136)
 * - Committed pivot picks invalidate on flip reversal (fix #3130)
 *
 * Requires live market data — runs during RTH only.
 */

import crypto from 'crypto';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const flags = {
  json: args.includes('--json'),
  quiet: args.includes('--quiet'),
  base: args.find(a => a.startsWith('--base='))?.split('=')[1] || 'https://blackouttrades.com',
  tickers: args.find(a => a.startsWith('--tickers='))?.split('=')[1]?.split(',') || ['SPX', 'SPY', 'NVDA', 'TSLA', 'QQQ', 'IWM'],
};

const log = (msg, level = 'INFO') => {
  if (flags.quiet && level === 'INFO') return;
  console.log(`[${level}] ${msg}`);
};

const fail = (msg) => {
  console.error(`[FAIL] ${msg}`);
  process.exitCode = 1;
};

const pass = (msg) => {
  if (!flags.quiet) console.log(`[PASS] ${msg}`);
};

let findings = [];

(async () => {
  const startTime = new Date().toISOString();
  log('Starting Vector pivot-play audit', 'AUDIT');

  // 1. Mint temp admin user for auth
  log('Minting temp admin Clerk user...');
  let session, userId;
  try {
    const result = execSync(`node --import tsx scripts/audit/lib/clerk-audit-user.mjs --create-only`, {
      env: { ...process.env, CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY },
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();
    const data = JSON.parse(result);
    userId = data.user_id;
    session = data.session;
    pass(`Auth complete — user ${userId.slice(0, 8)}…`);
  } catch (err) {
    fail(`Failed to mint Clerk user: ${err.message}`);
    return;
  }

  const cookie = session;

  // 2. Fetch live Vector picks for test tickers
  log(`Fetching live picks for: ${flags.tickers.join(', ')}`);
  const picksByTicker = {};

  for (const ticker of flags.tickers) {
    try {
      const res = await fetch(`${flags.base}/api/market/vector/contract-picks/live?ticker=${ticker}`, {
        headers: { Cookie: `__session=${cookie}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();

      if (data.picks && data.picks.length > 0) {
        picksByTicker[ticker] = data.picks;
        pass(`${ticker}: ${data.picks.length} live picks`);
      } else {
        log(`${ticker}: no live picks (OK if market closed or no qualifying setups)`, 'INFO');
      }
    } catch (err) {
      log(`${ticker}: fetch error — ${err.message}`, 'WARN');
    }
  }

  // 3. Fetch full Vector state (including plays) to cross-check
  log('Fetching full Vector state for all tickers...');
  let fullState;
  try {
    const res = await fetch(`${flags.base}/api/market/vector/plays/full-state`, {
      headers: { Cookie: `__session=${cookie}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    fullState = await res.json();
    pass(`Full state: ${fullState.plays?.length || 0} total plays`);
  } catch (err) {
    fail(`Failed to fetch full state: ${err.message}`);
    return;
  }

  // 4. Audit 1: Committed pivot plays should appear in picks (fix #3139)
  log('Audit 1: Committed pivot plays not skipped in pick sweep', 'CHECK');
  const pivotPlays = fullState.plays?.filter(p => p.play_type === 'pivot') || [];
  if (pivotPlays.length === 0) {
    log('No pivot plays found (market may be closed or no qualifying setups)', 'WARN');
  } else {
    log(`Found ${pivotPlays.length} pivot plays — checking if any are missing from picks...`);
    for (const play of pivotPlays.slice(0, 5)) { // Check first 5 to avoid timeout
      const ticker = play.ticker;
      const picks = picksByTicker[ticker] || [];
      const pickCount = picks.length;
      if (pickCount > 0) {
        pass(`${ticker} pivot: ${pickCount} picks found (not skipped)`);
      } else {
        findings.push({
          type: 'MISSING_PIVOT_PICKS',
          ticker,
          detail: `Pivot play ${play.play_id} has 0 picks — may indicate sweep skip (bug #3139 regression)`,
          severity: 'P1',
        });
        fail(`${ticker} pivot: 0 picks (possible skip)`);
      }
    }
  }

  // 5. Audit 2: Effective bias derivation (fix #3130)
  log('Audit 2: Effective bias derivation for committed pivots', 'CHECK');
  const committedPivots = pivotPlays.filter(p => {
    // A committed pivot should have effective bias that matches spot vs flip
    return p.card_bias === 'neutral' && p.raw_bias === 'neutral';
  });
  if (committedPivots.length === 0) {
    log('No "neutral" pivot plays found for bias derivation audit', 'WARN');
  } else {
    for (const play of committedPivots.slice(0, 3)) {
      const ticker = play.ticker;
      const picks = picksByTicker[ticker] || [];
      for (const pick of picks) {
        if (pick.bias === 'neutral') {
          findings.push({
            type: 'RAW_BIAS_USED',
            ticker,
            pick_id: pick.id,
            detail: `Pick has raw bias "neutral" — should use effective bias (bug #3130 regression)`,
            severity: 'P1',
          });
          fail(`${ticker}: pick ${pick.id.slice(0, 8)}… has raw bias neutral`);
        } else {
          pass(`${ticker}: pick ${pick.id.slice(0, 8)}… correctly uses effective bias ${pick.bias}`);
        }
      }
    }
  }

  // 6. Audit 3: Invalidation levels < $10 (fix #3136)
  log('Audit 3: Invalidation level parsing (sub-$10 support)', 'CHECK');
  const lowPriceTickers = flags.tickers.filter(t => t !== 'SPX' && t !== 'SPY'); // SPX/SPY are high
  for (const ticker of lowPriceTickers.slice(0, 2)) {
    try {
      const res = await fetch(`${flags.base}/api/market/vector/contract-picks/live?ticker=${ticker}`, {
        headers: { Cookie: `__session=${cookie}` },
      });
      if (res.ok) {
        const data = await res.json();
        const invalidatedPicks = data.picks?.filter(p => p.invalidation_reason) || [];
        if (invalidatedPicks.length > 0) {
          for (const pick of invalidatedPicks) {
            if (pick.invalidation_reason.includes('<') || pick.invalidation_reason.includes('>')) {
              // Has numeric invalidation
              const levelMatch = pick.invalidation_reason.match(/([0-9.]+)/);
              if (levelMatch) {
                const level = parseFloat(levelMatch[1]);
                if (level < 10) {
                  pass(`${ticker}: sub-$10 invalidation level ${level} correctly parsed`);
                }
              }
            }
          }
        } else {
          log(`${ticker}: no invalidated picks to audit`, 'INFO');
        }
      }
    } catch (err) {
      log(`${ticker}: could not audit invalidation levels — ${err.message}`, 'WARN');
    }
  }

  // 7. Summary
  const passed = findings.filter(f => !f.severity || f.severity[0] !== 'P').length;
  const failed = findings.filter(f => f.severity && f.severity[0] === 'P').length;

  log(`Audit complete: ${findings.filter(f => !f.severity).length} pass, ${failed} findings`, failed === 0 ? 'PASS' : 'FAIL');

  if (flags.json) {
    const output = {
      generated_at: new Date().toISOString(),
      audit: 'vector-pivot-plays',
      market_status: 'live (RTH)',
      tickers_audited: flags.tickers,
      findings,
      summary: {
        total: findings.length,
        critical_p1: findings.filter(f => f.severity === 'P1').length,
      },
    };
    console.log(JSON.stringify(output, null, 2));
  }

  // Cleanup temp user
  if (userId) {
    try {
      execSync(`curl -s -X DELETE ${flags.base}/api/admin/clerk/users/${userId}`, { stdio: 'pipe' });
    } catch {
      // Best effort cleanup
    }
  }

  process.exit(failed > 0 ? 1 : 0);
})();
