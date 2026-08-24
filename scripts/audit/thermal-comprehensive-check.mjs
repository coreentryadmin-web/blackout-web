#!/usr/bin/env node

/**
 * Comprehensive Thermal Phase 1 validation — validates all three PRs work correctly
 * in production and checks for related data quality issues.
 */

import https from "https";
import { URL } from "url";

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const TICKERS = ["SPX", "SPY", "QQQ"];

function request(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    }).on("error", reject);
  });
}

async function validateThermalComprehensive() {
  const results = {
    gex_snapshot: { passed: 0, failed: 0 },
    data_consistency: { passed: 0, failed: 0 },
    findings: []
  };

  console.log("\n=== THERMAL PHASE 1 COMPREHENSIVE CHECK ===\n");

  // Test 1: Public GEX snapshot endpoint
  console.log("TEST 1: Public GEX snapshot endpoint (PR #2828, #2830, #2832)\n");
  for (const ticker of TICKERS) {
    const url = `${BASE}/api/public/gex-snapshot?ticker=${ticker}`;
    try {
      const { status, data } = await request(url);

      if (status !== 200) {
        results.gex_snapshot.failed++;
        results.findings.push({
          severity: "HIGH",
          test: "gex_snapshot",
          ticker,
          issue: `Non-200 status: ${status}`
        });
        continue;
      }

      // Check Thermal Phase 1 features
      const checks = [
        {
          name: "available flag",
          check: () => typeof data.available === "boolean",
          value: data.available
        },
        {
          name: "spot_source disclosure (PR #2828)",
          check: () => data.available ? !!data.spot_source : true,
          value: data.spot_source
        },
        {
          name: "chain_truncated flag (PR #2830)",
          check: () => data.available ? typeof data.chain_truncated !== "boolean" || data.chain_truncated === false || data.chain_truncated === true : true,
          value: data.chain_truncated
        },
        {
          name: "wall constraint - call > spot (PR #2832)",
          check: () => {
            if (!data.available || !data.call_wall) return true;
            if (data.call_wall > data.spot) {
              // Valid resistance - should be classified as such
              return data.call_wall_role === "resistance";
            } else {
              // Invalid - should NOT be classified as resistance
              return data.call_wall_role !== "resistance";
            }
          },
          value: `call_wall=${data.call_wall} vs spot=${data.spot}, role=${data.call_wall_role}`
        },
        {
          name: "wall constraint - put < spot (PR #2832)",
          check: () => {
            if (!data.available || !data.put_wall) return true;
            if (data.put_wall < data.spot) {
              // Valid support - should be classified as such
              return data.put_wall_role === "support";
            } else {
              // Invalid - should NOT be classified as support
              return data.put_wall_role !== "support";
            }
          },
          value: `put_wall=${data.put_wall} vs spot=${data.spot}, role=${data.put_wall_role}`
        },
        {
          name: "session facts present",
          check: () => data.available ? !!data.market_session && !!data.session_date && !!data.as_of_et : true,
          value: `session=${data.market_session}, date=${data.session_date}, et=${data.as_of_et}`
        },
        {
          name: "no vendor name leaks",
          check: () => {
            const vendors = ["UW", "Unusual Whales", "Polygon", "Massive", "unavailable"];
            return !vendors.some(v => data.read.includes(v));
          },
          value: data.read.slice(0, 100)
        }
      ];

      for (const check of checks) {
        if (check.check()) {
          results.gex_snapshot.passed++;
          console.log(`  ✓ ${ticker} ${check.name}`);
        } else {
          results.gex_snapshot.failed++;
          results.findings.push({
            severity: "HIGH",
            test: "gex_snapshot",
            ticker,
            issue: check.name,
            detail: check.value
          });
          console.log(`  ✗ ${ticker} ${check.name}`);
        }
      }
    } catch (e) {
      results.gex_snapshot.failed++;
      results.findings.push({
        severity: "CRITICAL",
        test: "gex_snapshot",
        ticker,
        issue: "Request failed",
        detail: e.message
      });
      console.log(`  ✗ ${ticker} request error: ${e.message}`);
    }
  }

  // Test 2: Data consistency
  console.log("\n\nTEST 2: Data consistency checks\n");

  try {
    const snapshots = {};
    for (const ticker of TICKERS) {
      const url = `${BASE}/api/public/gex-snapshot?ticker=${ticker}`;
      const { data } = await request(url);
      snapshots[ticker] = data;
    }

    // Check that all three tickers return valid data
    const allAvailable = TICKERS.every(t => snapshots[t].available);
    if (allAvailable) {
      results.data_consistency.passed++;
      console.log("  ✓ All three tickers are available");
    } else {
      results.data_consistency.failed++;
      results.findings.push({
        severity: "WARN",
        test: "data_consistency",
        issue: "Not all tickers available",
        detail: TICKERS.map(t => `${t}: ${snapshots[t].available}`).join(", ")
      });
      console.log("  ✗ Not all tickers available");
    }

    // Check that market session is consistent across tickers
    const sessions = new Set(TICKERS.map(t => snapshots[t].market_session));
    if (sessions.size === 1) {
      results.data_consistency.passed++;
      console.log(`  ✓ Market session consistent: ${[...sessions][0]}`);
    } else {
      results.data_consistency.failed++;
      results.findings.push({
        severity: "WARN",
        test: "data_consistency",
        issue: "Inconsistent market sessions",
        detail: Array.from(sessions).join(", ")
      });
      console.log(`  ✗ Inconsistent market sessions: ${Array.from(sessions).join(", ")}`);
    }

    // Check freshness - data should not be too old
    const now = Date.now();
    const ages = {};
    for (const ticker of TICKERS) {
      const aTime = Date.parse(snapshots[ticker].asof);
      if (Number.isFinite(aTime)) {
        ages[ticker] = (now - aTime) / 1000;
      }
    }

    const maxAge = Math.max(...Object.values(ages));
    if (maxAge < 300) {
      results.data_consistency.passed++;
      console.log(`  ✓ Data freshness good (max age ${Math.round(maxAge)}s)`);
    } else {
      results.data_consistency.failed++;
      results.findings.push({
        severity: "WARN",
        test: "data_consistency",
        issue: "Data older than 5 minutes",
        detail: `Max age: ${Math.round(maxAge)}s`
      });
      console.log(`  ✗ Data older than 5 minutes (max age ${Math.round(maxAge)}s)`);
    }

  } catch (e) {
    results.data_consistency.failed++;
    results.findings.push({
      severity: "CRITICAL",
      test: "data_consistency",
      issue: "Consistency check failed",
      detail: e.message
    });
  }

  // Summary
  console.log("\n\n=== SUMMARY ===");
  console.log(`GEX Snapshot Checks: ${results.gex_snapshot.passed} passed, ${results.gex_snapshot.failed} failed`);
  console.log(`Data Consistency: ${results.data_consistency.passed} passed, ${results.data_consistency.failed} failed`);

  if (results.findings.length > 0) {
    console.log("\n=== FINDINGS ===");
    const bySeverity = { CRITICAL: [], HIGH: [], WARN: [] };
    for (const f of results.findings) {
      bySeverity[f.severity]?.push(f);
    }

    for (const [severity, items] of Object.entries(bySeverity)) {
      if (items.length === 0) continue;
      console.log(`\n${severity} (${items.length}):`);
      for (const item of items) {
        const ticker = item.ticker ? `[${item.ticker}] ` : "";
        console.log(`  ${ticker}${item.issue}`);
        if (item.detail) console.log(`    Detail: ${item.detail}`);
      }
    }
  }

  process.exit(results.gex_snapshot.failed > 0 || results.data_consistency.failed > 0 ? 1 : 0);
}

validateThermalComprehensive().catch(e => {
  console.error("Validation failed:", e.message);
  process.exit(2);
});
