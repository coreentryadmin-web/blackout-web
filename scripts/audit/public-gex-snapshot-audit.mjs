#!/usr/bin/env node

/**
 * Audit the public GEX snapshot endpoint (/api/public/gex-snapshot) to ensure
 * Thermal Phase 1 features are working correctly in production:
 * 1. spot_source disclosure (PR #2828)
 * 2. chain_truncated flag (PR #2830)
 * 3. Client-side wall constraint (PR #2832)
 * 4. Wall-side classification (classifyWall behavior)
 * 5. Read sanitization (no vendor names)
 * 6. Session facts and freshness accuracy
 */

import https from "https";

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const TICKERS = ["SPX", "SPY", "QQQ"];

// Helper to make HTTPS requests
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

async function auditPublicGexSnapshot() {
  const results = { passed: 0, failed: 0, findings: [] };
  const now = Date.now();

  console.log("\n=== PUBLIC GEX SNAPSHOT AUDIT ===\n");

  for (const ticker of TICKERS) {
    console.log(`\nTesting ticker: ${ticker}`);
    const url = `${BASE}/api/public/gex-snapshot?ticker=${ticker}`;

    try {
      const { status, data } = await request(url);

      if (status !== 200) {
        results.failed++;
        results.findings.push({
          severity: "HIGH",
          ticker,
          issue: `Non-200 status: ${status}`,
          detail: JSON.stringify(data).slice(0, 200)
        });
        continue;
      }

      // Validate structure
      const schema = {
        available: "boolean",
        ticker: "string",
        spot: ["number", "null"],
        change_pct: ["number", "null"],
        asof: ["string", "null"],
        call_wall: ["number", "null"],
        put_wall: ["number", "null"],
        flip: ["number", "null"],
        posture: ["string", "null"],
        call_wall_role: ["string", "null"],
        put_wall_role: ["string", "null"],
        read: "string",
        market_session: ["string", "null"],
        session_date: ["string", "null"],
        as_of_et: ["string", "null"],
        spot_source: "string", // OPTIONAL but should be present if available
        chain_truncated: "boolean" // OPTIONAL but should be present if true
      };

      for (const [field, expectedType] of Object.entries(schema)) {
        const value = data[field];
        const types = Array.isArray(expectedType) ? expectedType : [expectedType];
        const actualType = value === null ? "null" : typeof value;

        if (field === "spot_source" || field === "chain_truncated") {
          // Optional fields
          if (value !== undefined && !types.includes(actualType)) {
            results.failed++;
            results.findings.push({
              severity: "MEDIUM",
              ticker,
              field,
              issue: `Optional field has wrong type: expected ${types.join("|")}, got ${actualType}`,
              value: value
            });
          }
          continue;
        }

        if (!types.includes(actualType)) {
          results.failed++;
          results.findings.push({
            severity: "HIGH",
            ticker,
            field,
            issue: `Wrong type: expected ${types.join("|")}, got ${actualType}`,
            value: value
          });
        }
      }

      // Validate specific Thermal Phase 1 features
      if (data.available) {
        // 1. spot_source should be present (PR #2828)
        if (!data.spot_source) {
          results.failed++;
          results.findings.push({
            severity: "HIGH",
            ticker,
            issue: "PR #2828 (spot_source) not present when available=true",
            detail: "spot_source disclosure is missing"
          });
        } else {
          if (!["ws", "redis_cluster", "rest", "prev_bar", "synthetic"].includes(data.spot_source)) {
            results.failed++;
            results.findings.push({
              severity: "HIGH",
              ticker,
              issue: "Invalid spot_source value",
              value: data.spot_source,
              detail: "Expected one of: ws, redis_cluster, rest, prev_bar, synthetic"
            });
          } else {
            results.passed++;
          }
        }

        // 2. chain_truncated flag (PR #2830) - optional but when true must be explicit
        if (data.chain_truncated === true) {
          results.passed++;
          console.log(`  ✓ Chain was truncated (pagination guard applied)`);
        } else if (data.chain_truncated === false || data.chain_truncated === undefined) {
          results.passed++;
        } else {
          results.failed++;
          results.findings.push({
            severity: "MEDIUM",
            ticker,
            issue: "chain_truncated has unexpected value",
            value: data.chain_truncated
          });
        }

        // 3. Wall constraint validation (PR #2832)
        // Check that walls don't violate the constraint: call > spot, put < spot
        if (data.spot && data.call_wall) {
          if (data.call_wall > data.spot) {
            // Valid resistance
            if (data.call_wall_role !== "resistance") {
              results.failed++;
              results.findings.push({
                severity: "HIGH",
                ticker,
                issue: "Call wall above spot should be classified as resistance",
                detail: `call_wall=${data.call_wall}, spot=${data.spot}, role=${data.call_wall_role}`
              });
            } else {
              results.passed++;
            }
          } else if (data.call_wall < data.spot) {
            // Wrong side - should be concentration or null
            if (data.call_wall_role === "resistance") {
              results.failed++;
              results.findings.push({
                severity: "HIGH",
                ticker,
                issue: "Call wall below spot incorrectly classified as resistance",
                detail: `call_wall=${data.call_wall}, spot=${data.spot} (constraint violated!)`
              });
            } else {
              results.passed++;
            }
          }
        }

        if (data.spot && data.put_wall) {
          if (data.put_wall < data.spot) {
            // Valid support
            if (data.put_wall_role !== "support") {
              results.failed++;
              results.findings.push({
                severity: "HIGH",
                ticker,
                issue: "Put wall below spot should be classified as support",
                detail: `put_wall=${data.put_wall}, spot=${data.spot}, role=${data.put_wall_role}`
              });
            } else {
              results.passed++;
            }
          } else if (data.put_wall > data.spot) {
            // Wrong side - should be concentration or null
            if (data.put_wall_role === "support") {
              results.failed++;
              results.findings.push({
                severity: "HIGH",
                ticker,
                issue: "Put wall above spot incorrectly classified as support",
                detail: `put_wall=${data.put_wall}, spot=${data.spot} (constraint violated!)`
              });
            } else {
              results.passed++;
            }
          }
        }

        // 4. Read sanitization - no vendor names should leak
        const vendorNames = ["UW", "Unusual Whales", "Polygon", "Massive", "unavailable"];
        for (const vendor of vendorNames) {
          if (data.read.includes(vendor)) {
            results.failed++;
            results.findings.push({
              severity: "HIGH",
              ticker,
              issue: `Vendor name "${vendor}" leaked in read`,
              detail: `Read: ${data.read.slice(0, 100)}...`
            });
          }
        }

        // 5. Session facts validation
        if (data.market_session && !["OPEN", "PRE-MARKET", "AFTER-HOURS", "CLOSED"].includes(data.market_session)) {
          results.failed++;
          results.findings.push({
            severity: "HIGH",
            ticker,
            issue: "Invalid market_session value",
            value: data.market_session
          });
        }

        if (data.session_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.session_date)) {
          results.failed++;
          results.findings.push({
            severity: "HIGH",
            ticker,
            issue: "Invalid session_date format",
            value: data.session_date,
            detail: "Expected YYYY-MM-DD"
          });
        }

        // 6. Freshness validation
        if (data.asof) {
          const aTime = Date.parse(data.asof);
          if (!Number.isFinite(aTime)) {
            results.failed++;
            results.findings.push({
              severity: "HIGH",
              ticker,
              issue: "Invalid asof timestamp",
              value: data.asof
            });
          } else {
            const age = (now - aTime) / 1000;
            if (age > 300) {
              // More than 5 minutes old
              results.findings.push({
                severity: "WARN",
                ticker,
                issue: `Snapshot older than 5 minutes (${Math.round(age)}s old)`,
                detail: `asof=${data.asof}, now=${new Date(now).toISOString()}`
              });
            }
          }
        }
      }

      // Rate limit headers check
      console.log(`  Status: ${status}`);
      if (data.available) {
        console.log(`  ✓ Available | ${data.market_session} | Spot: ${data.spot}`);
        console.log(`  ✓ Call wall: ${data.call_wall} (${data.call_wall_role}) | Put wall: ${data.put_wall} (${data.put_wall_role})`);
        if (data.spot_source) console.log(`  ✓ Spot source: ${data.spot_source}`);
        if (data.chain_truncated) console.log(`  ⚠ Chain truncated by pagination guard`);
      } else {
        console.log(`  ⚠ Snapshot unavailable (warming up)`);
      }
    } catch (e) {
      results.failed++;
      results.findings.push({
        severity: "CRITICAL",
        ticker,
        issue: "Request failed",
        detail: e.message
      });
      console.log(`  ✗ Request error: ${e.message}`);
    }
  }

  // Print summary
  console.log("\n=== SUMMARY ===");
  console.log(`Checks passed: ${results.passed}`);
  console.log(`Checks failed: ${results.failed}`);

  if (results.findings.length > 0) {
    console.log("\n=== FINDINGS ===");
    const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], WARN: [] };
    for (const f of results.findings) {
      bySeverity[f.severity]?.push(f);
    }

    for (const [severity, items] of Object.entries(bySeverity)) {
      if (items.length === 0) continue;
      console.log(`\n${severity} (${items.length}):`);
      for (const item of items) {
        console.log(`  [${item.ticker}] ${item.issue}`);
        if (item.detail) console.log(`    Detail: ${item.detail}`);
        if (item.value !== undefined) console.log(`    Value: ${JSON.stringify(item.value)}`);
      }
    }
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

auditPublicGexSnapshot().catch(e => {
  console.error("Audit failed:", e.message);
  process.exit(2);
});
