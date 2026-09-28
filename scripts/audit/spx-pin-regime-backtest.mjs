#!/usr/bin/env node
/**
 * SPX PIN regime inversion historical backtest.
 *
 * Compares forecasts generated with the OLD inverted regime logic vs NEW correct logic
 * against actual historical SPX price movements to measure accuracy improvement.
 *
 * Run: npx tsx scripts/audit/spx-pin-regime-backtest.mjs [--days=N] [--json]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the actual PIN forecast engine and its helpers
// Note: This requires TypeScript compilation, so we'll use tsx to run this file
import { forecastPin } from '../../src/features/spx/lib/spx-pin-forecast-core.js';

/**
 * Regime classification with OLD inverted logic (for A/B comparison)
 */
function classifyRegimeOld(flip, spot) {
  // OLD INVERTED: spot >= flip → LONG gamma (WRONG)
  return flip != null ? (spot >= flip ? "long_gamma" : "short_gamma") : "unknown";
}

/**
 * Regime classification with NEW correct logic
 */
function classifyRegimeNew(flip, spot) {
  // NEW CORRECT: spot >= flip → SHORT gamma (RIGHT)
  return flip != null ? (spot >= flip ? "short_gamma" : "long_gamma") : "unknown";
}

/**
 * Create a modified forecast input that uses OLD inverted regime logic
 * by injecting it into the forecast generation
 */
function forecastWithRegimeOverride(input, useNewRegime = true) {
  // This is a placeholder - in production this would patch the prepare() function
  // to use the desired regime logic before running the forecast

  // For now, we'll record what the forecast produces and note which regime was used
  const forecast = forecastPin(input);

  return {
    ...forecast,
    usedNewLogic: useNewRegime,
  };
}

/**
 * Load historical SPX price data and Option Expiry data
 * Returns: { date, spot_open, spot_close, bars, options_data }[]
 */
async function loadHistoricalData(daysBack = 90) {
  // This would fetch from Polygon API or read from local cache
  // For now, structure shows what data is needed:

  const historicalScenarios = [
    // Each scenario needs:
    // {
    //   date: "2026-07-21",
    //   session_start_time: "2026-07-21T13:30:00Z",
    //   spot_at_forecast_time: 7507.6,
    //   contracts: [...],
    //   bar_data: [{date, open, high, low, close, vwap}],
    //   actual_next_bars: {...},
    //   session_close_actual: 7450.33,
    // }
  ];

  return historicalScenarios;
}

/**
 * Grade a single forecast against actual price movement
 */
function gradeForcast(forecast, actualData) {
  if (!forecast.available || !forecast.magnet) {
    return { status: "unavailable", accuracy: null, move: null };
  }

  const predictedDirection = forecast.magnet.direction;
  const magnetStrike = forecast.magnet.strike;
  const spot = forecast.spot;

  // Actual move: from forecast spot to closing price
  const actualMove = actualData.session_close_actual - spot;
  const actualDirection = actualMove > 0.5 ? "up" : actualMove < -0.5 ? "down" : "flat";

  // Correctness: did prediction match actual?
  const correct = predictedDirection === actualDirection;

  // Magnitude accuracy: how close to predicted strike?
  const closenessToMagnet = Math.abs(actualData.session_close_actual - magnetStrike);

  return {
    status: "graded",
    predicted_direction: predictedDirection,
    predicted_magnet: magnetStrike,
    actual_direction: actualDirection,
    actual_close: actualData.session_close_actual,
    actual_move: actualMove,
    directional_correct: correct,
    magnet_distance_pts: closenessToMagnet,
    accuracy_score: correct ? 1 : 0,
  };
}

/**
 * Run the full backtest
 */
async function runBacktest(options = {}) {
  const daysBack = options.days || 90;
  const jsonOutput = options.json || false;

  console.log(`\n=== SPX PIN Regime Inversion Backtest ===`);
  console.log(`Window: ${daysBack}-day historical`);
  console.log(`Comparing: OLD inverted regime vs NEW correct regime\n`);

  // Load historical data
  const historicalScenarios = await loadHistoricalData(daysBack);

  if (historicalScenarios.length === 0) {
    console.log("⚠️  No historical data available. Backtest requires:");
    console.log("   - Historical PIN forecast inputs (contracts, spot, vol, time)");
    console.log("   - Actual SPX closing prices for validation");
    console.log("   - Option expiry and IV data");
    console.log("\nNext steps:");
    console.log("   1. Implement data loader (Polygon or cached historical snapshots)");
    console.log("   2. Run forecastPin with each historical input");
    console.log("   3. Grade against actual prices");
    process.exit(1);
  }

  // Run forecasts with both OLD and NEW logic
  const results = [];
  let totalOld = 0, totalNew = 0;
  let correctOld = 0, correctNew = 0;
  let correctUpOld = 0, correctUpNew = 0;
  let correctDownOld = 0, correctDownNew = 0;

  for (const scenario of historicalScenarios) {
    // Forecast with current (NEW correct) logic
    const forecastNew = forecastPin(scenario.input);
    const gradeNew = gradeForcast(forecastNew, scenario);

    // To get OLD logic forecast, would need to:
    // 1. Create a patched version of prepare() that uses classifyRegimeOld
    // 2. Run it against the same input
    // For now, we can't directly, so we'll note that this is needed:

    if (gradeNew.status === "graded") {
      totalNew++;
      if (gradeNew.directional_correct) correctNew++;

      if (gradeNew.actual_direction === "up" && gradeNew.predicted_direction === "up") correctUpNew++;
      if (gradeNew.actual_direction === "down" && gradeNew.predicted_direction === "down") correctDownNew++;
    }

    results.push({
      date: scenario.date,
      spot: scenario.input.spot,
      regime_new: forecastNew.regime,
      direction_new: forecastNew.magnet?.direction,
      close_actual: scenario.actual_data.session_close_actual,
      correct_new: gradeNew.directional_correct,
      // old_regime, old_direction, correct_old would be computed here
    });
  }

  // Print results
  console.log(`Backtest Results (${totalNew} graded scenarios):`);
  console.log(`\nNew Correct Logic (spot >= flip → short_gamma):`);
  console.log(`  Overall accuracy: ${(correctNew / totalNew * 100).toFixed(1)}% (${correctNew}/${totalNew})`);
  console.log(`  Bullish accuracy: ${(correctUpNew > 0 ? correctUpNew / results.filter(r => r.direction_new === "up").length * 100 : 0).toFixed(1)}%`);
  console.log(`  Bearish accuracy: ${(correctDownNew > 0 ? correctDownNew / results.filter(r => r.direction_new === "down").length * 100 : 0).toFixed(1)}%`);

  console.log(`\n⚠️  OLD Inverted Logic results would show here after implementation`);
  console.log(`   (requires patching prepare() to use classifyRegimeOld)\n`);

  if (jsonOutput) {
    console.log(JSON.stringify({ results, summary: {
      total: totalNew,
      accuracy_new: correctNew / totalNew,
      accuracy_old: "TODO: requires old logic implementation",
      accuracy_delta: "TODO",
    }}, null, 2));
  }
}

// Main
const args = process.argv.slice(2);
const options = {
  days: args.find(a => a.startsWith('--days'))?.split('=')[1] || 90,
  json: args.includes('--json'),
};

runBacktest(options).catch(err => {
  console.error("Backtest failed:", err.message);
  process.exit(1);
});
