#!/usr/bin/env node
/**
 * LARGO TRUNCATION MEASUREMENT — capture exact truncation points for each of 10 tools
 *
 * For each truncation found in phase 3:
 * - Measure last_key in truncated payload
 * - Count fields before/after truncation
 * - Estimate impact on answer quality
 * - Document field-level structure for fix design
 *
 * Read-only. One temp Clerk user, deleted in finally.
 *
 * Usage:
 *   node --import tsx scripts/audit/largo-truncation-measurement.mjs \
 *     [--tools=get_market_context,get_nighthawk_dossier] [--base=https://...] [--json]
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const JSON_OUT = process.argv.includes("--json");
const BASE = arg("base", "https://blackouttrades.com").replace(/\/$/, "");

// The 10 truncations found in phase 3
const TRUNCATIONS = [
  {
    tool: "get_market_context",
    category: "Cross-product state",
    args: "",
    priority: "P2",
  },
  {
    tool: "get_nighthawk_dossier",
    category: "Full board state",
    args: "",
    priority: "P2",
  },
  {
    tool: "get_banger_board",
    category: "100+ candidates",
    args: "",
    priority: "P2",
  },
  {
    tool: "get_analyst_ratings",
    category: "Market-wide consensus",
    args: "",
    priority: "P3",
  },
  {
    tool: "get_confluence_outcomes",
    category: "Historical grading",
    args: "",
    priority: "P3",
  },
  {
    tool: "get_group_greek_flow",
    category: "Greek by group",
    args: "",
    priority: "P3",
  },
  {
    tool: "get_market_oi_change",
    category: "OI changes 100+ tickers",
    args: "",
    priority: "P3",
  },
  {
    tool: "get_market_stats",
    category: "Market aggregates",
    args: "",
    priority: "P3",
  },
  {
    tool: "get_platform_snapshot",
    category: "Active sessions/members",
    args: "",
    priority: "P3",
  },
  {
    tool: "get_screener",
    category: "Ranked candidates",
    args: "",
    priority: "P3",
  },
];

const log = (msg, data = "") => {
  if (JSON_OUT) return;
  console.log(`[${new Date().toISOString()}] ${msg}`, data ? data : "");
};

/**
 * Ask the model to call a specific tool and observe truncation
 */
async function measureTruncation(session, tool, toolArgs, base) {
  const questionMap = {
    get_market_context: "What's the current market state across all products?",
    get_nighthawk_dossier: "Show me the full Night Hawk dossier.",
    get_banger_board: "What are all the banger candidates today?",
    get_analyst_ratings: "What are market-wide analyst ratings?",
    get_confluence_outcomes: "Show me historical confluence outcomes.",
    get_group_greek_flow: "What's the greek flow by group?",
    get_market_oi_change: "Show me all open interest changes.",
    get_market_stats: "What are the complete market statistics?",
    get_platform_snapshot: "Show me the complete platform state.",
    get_screener: "Show me all screener results.",
  };

  const question = questionMap[tool] || `Call ${tool}`;

  try {
    const resp = await fetch(`${base}/api/largo/measure-truncation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
      },
      body: JSON.stringify({
        tool,
        tool_args: toolArgs,
        question,
        capture_payload: true,
        capture_metadata: true,
      }),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();

    return {
      tool,
      truncated: data.truncated || false,
      payload_size_bytes: data.payload_size_bytes || 0,
      truncated_at_char: data.truncated_at_char || 0,
      last_key: data.last_key || "",
      field_count_before: data.field_count_before || 0,
      field_count_after: data.field_count_after || 0,
      lost_fields: data.lost_fields || [],
      impact: data.impact || "UNKNOWN",
      recommendations: data.recommendations || [],
    };
  } catch (e) {
    return {
      tool,
      error: e.message,
      truncated: false,
    };
  }
}

/**
 * Main measurement run
 */
async function main() {
  let session;
  let userId;

  try {
    log("Starting Largo truncation measurement...");
    log(`Base URL: ${BASE}`);

    // Mint session
    const { cookie, user_id } = await mintClerkPremiumSession();
    session = { cookie };
    userId = user_id;

    log(`Authenticated as temp user ${userId}`);

    const measurements = [];
    const results = {
      timestamp: new Date().toISOString(),
      truncations_measured: 0,
      truncations_confirmed: 0,
      measurements: [],
      summary: {
        p2_findings: [],
        p3_findings: [],
        fix_recommendations: [],
      },
    };

    // Measure each truncation
    for (const truncation of TRUNCATIONS) {
      log(
        `Measuring: ${truncation.tool} (${truncation.priority} - ${truncation.category})`
      );

      const measurement = await measureTruncation(
        session,
        truncation.tool,
        truncation.args,
        BASE
      );

      measurement.priority = truncation.priority;
      measurement.category = truncation.category;

      if (!measurement.error) {
        results.truncations_measured++;
        if (measurement.truncated) {
          results.truncations_confirmed++;
        }
      }

      results.measurements.push(measurement);

      if (measurement.truncated) {
        log(
          `  ✓ TRUNCATED at char ${measurement.truncated_at_char}, lost ${measurement.lost_fields.length} fields`
        );
        log(
          `    Last key: ${measurement.last_key}`
        );
        log(
          `    Field count: ${measurement.field_count_before} before → ${measurement.field_count_after} after`
        );
        log(
          `    Impact: ${measurement.impact}`
        );

        // Organize by priority
        if (truncation.priority === "P2") {
          results.summary.p2_findings.push({
            tool: truncation.tool,
            lost_fields: measurement.lost_fields.length,
            impact: measurement.impact,
          });
        } else {
          results.summary.p3_findings.push({
            tool: truncation.tool,
            lost_fields: measurement.lost_fields.length,
            impact: measurement.impact,
          });
        }

        // Record recommendations
        if (measurement.recommendations && measurement.recommendations.length) {
          results.summary.fix_recommendations.push({
            tool: truncation.tool,
            options: measurement.recommendations,
          });
        }
      } else {
        log(`  ⚠ Not truncated (probe may need larger arguments)`);
      }
    }

    // Output results
    if (JSON_OUT) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      log("\n=== MEASUREMENT SUMMARY ===");
      log(`Truncations measured: ${results.truncations_measured}`);
      log(`Truncations confirmed: ${results.truncations_confirmed}`);
      log(`P2 findings: ${results.summary.p2_findings.length}`);
      log(`P3 findings: ${results.summary.p3_findings.length}`);
      log(
        `Fix options identified: ${results.summary.fix_recommendations.length}`
      );
    }

    // Save to file
    const fs = await import("fs/promises");
    await fs.writeFile(
      "docs/audit/LARGO-TRUNCATION-MEASUREMENTS.json",
      JSON.stringify(results, null, 2)
    );
    log("Detailed measurements saved to docs/audit/LARGO-TRUNCATION-MEASUREMENTS.json");
  } finally {
    if (userId) {
      log(`Cleanup: deleting temp user ${userId}`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
