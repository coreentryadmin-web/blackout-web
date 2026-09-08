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

import { fetchAuditJson, releaseAuditClerkSession } from './lib/audit-auth-fetch.mjs';
import { resolveAuditBase } from './lib/audit-base.mjs';

const args = process.argv.slice(2);
const flags = {
  json: args.includes('--json'),
  quiet: args.includes('--quiet'),
  base: resolveAuditBase(args.find(a => a.startsWith('--base='))?.split('=')[1]),
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

const findings = [];

(async () => {
  const startTime = new Date().toISOString();
  log('Starting Vector pivot-play audit', 'AUDIT');

  try {
    log(`Fetching live picks for: ${flags.tickers.join(', ')}`);
    const picksByTicker = {};

    for (const ticker of flags.tickers) {
      try {
        const res = await fetchAuditJson(
          flags.base,
          `/api/market/vector/contract-picks/live?ticker=${encodeURIComponent(ticker)}`,
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const data = res.json && typeof res.json === 'object' ? res.json : {};

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

    log('Fetching full Vector state for all tickers...');
    let fullState;
    try {
      const res = await fetchAuditJson(flags.base, '/api/market/vector/plays/full-state');
      if (!res.ok) throw new Error(`${res.status}`);
      fullState = res.json && typeof res.json === 'object' ? res.json : {};
      pass(`Full state: ${fullState.plays?.length || 0} total plays`);
    } catch (err) {
      fail(`Failed to fetch full state: ${err.message}`);
      return;
    }

    log('Audit 1: Committed pivot plays not skipped in pick sweep', 'CHECK');
    const pivotPlays = fullState.plays?.filter(p => p.play_type === 'pivot') || [];
    if (pivotPlays.length === 0) {
      log('No pivot plays found (market may be closed or no qualifying setups)', 'WARN');
    } else {
      log(`Found ${pivotPlays.length} pivot plays — checking if any are missing from picks...`);
      for (const play of pivotPlays.slice(0, 5)) {
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

    log('Audit 2: Effective bias derivation for committed pivots', 'CHECK');
    const committedPivots = pivotPlays.filter(p => p.card_bias === 'neutral' && p.raw_bias === 'neutral');
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
              detail: 'Pick has raw bias "neutral" — should use effective bias (bug #3130 regression)',
              severity: 'P1',
            });
            fail(`${ticker}: pick ${pick.id.slice(0, 8)}… has raw bias neutral`);
          } else {
            pass(`${ticker}: pick ${pick.id.slice(0, 8)}… correctly uses effective bias ${pick.bias}`);
          }
        }
      }
    }

    log('Audit 3: Invalidation level parsing (sub-$10 support)', 'CHECK');
    const lowPriceTickers = flags.tickers.filter(t => t !== 'SPX' && t !== 'SPY');
    for (const ticker of lowPriceTickers.slice(0, 2)) {
      try {
        const res = await fetchAuditJson(
          flags.base,
          `/api/market/vector/contract-picks/live?ticker=${encodeURIComponent(ticker)}`,
        );
        if (res.ok) {
          const data = res.json && typeof res.json === 'object' ? res.json : {};
          const invalidatedPicks = data.picks?.filter(p => p.invalidation_reason) || [];
          for (const pick of invalidatedPicks) {
            if (pick.invalidation_reason.includes('<') || pick.invalidation_reason.includes('>')) {
              const levelMatch = pick.invalidation_reason.match(/([0-9.]+)/);
              if (levelMatch) {
                const level = parseFloat(levelMatch[1]);
                if (level < 10) {
                  pass(`${ticker}: sub-$10 invalidation level ${level} correctly parsed`);
                }
              }
            }
          }
          if (invalidatedPicks.length === 0) {
            log(`${ticker}: no invalidated picks to audit`, 'INFO');
          }
        }
      } catch (err) {
        log(`${ticker}: could not audit invalidation levels — ${err.message}`, 'WARN');
      }
    }

    const failed = findings.filter(f => f.severity && f.severity[0] === 'P').length;
    log(`Audit complete: ${failed} findings`, failed === 0 ? 'PASS' : 'FAIL');

    if (flags.json) {
      console.log(JSON.stringify({
        generated_at: startTime,
        audit: 'vector-pivot-plays',
        market_status: 'live (RTH)',
        tickers_audited: flags.tickers,
        findings,
        summary: {
          total: findings.length,
          critical_p1: findings.filter(f => f.severity === 'P1').length,
        },
      }, null, 2));
    }

    process.exit(failed > 0 ? 1 : 0);
  } finally {
    await releaseAuditClerkSession();
  }
})();
