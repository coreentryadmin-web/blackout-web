#!/usr/bin/env node
/**
 * LARGO CROSS-PRODUCT STRESS TEST
 *
 * Adversarial testing of the new cross-product-ranking and live-multiproduct-board tools
 * against LIVE production. Tests edge cases: multi-ticker queries, conflicting signals,
 * thin data, timeframe/metric combinations, graceful degradation.
 *
 * Usage:
 *   node --import tsx scripts/audit/largo-cross-product-stress.mjs
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/largo-cross-product-stress.mjs [--json]
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const JSON_OUT = process.argv.includes("--json");

const QUESTIONS = [
  // ── Tier 1: Basic cross-product ranking queries ──────────────────────────────────────
  {
    id: "spx-0dte-edge",
    desk: "cross-product",
    q: "Which product has the best 0DTE edge on SPX right now?",
    tool: "get_cross_product_ranking",
    input: { ticker: "SPX", direction: "bull", timeframe: "0dte", metric: "edge" },
    expect: {
      mustMentionAny: ["Vector", "Night Hawk", "SPX Slayer", "Thermal", "Helix", "Meridian", "product", "edge"],
      mustCallAny: ["get_cross_product_ranking"],
    },
  },
  {
    id: "nvda-weekly-confidence",
    desk: "cross-product",
    q: "Rank all desks by confidence on a weekly NVDA call",
    tool: "get_cross_product_ranking",
    input: { ticker: "NVDA", direction: "call", timeframe: "weekly", metric: "confidence" },
    expect: {
      mustMentionAny: ["confidence", "NVDA", "weekly"],
      mustCallAny: ["get_cross_product_ranking"],
    },
  },
  {
    id: "qqq-earnings-wr",
    desk: "cross-product",
    q: "Which desk has the best historical win rate on QQQ around earnings?",
    tool: "get_cross_product_ranking",
    input: { ticker: "QQQ", direction: "bull", timeframe: "earnings", metric: "win_rate" },
    expect: {
      mustMentionAny: ["win rate", "earnings", "QQQ"],
      mustCallAny: ["get_cross_product_ranking"],
      mayBeInsufficient: true, // earnings data may not be fresh right now
    },
  },

  // ── Tier 2: Live multiproduct board queries ──────────────────────────────────────────
  {
    id: "board-edge",
    desk: "cross-product",
    q: "Show me the top setups across all desks ranked by edge right now",
    tool: "get_live_multiproduct_board",
    input: { metric: "edge", limit: 5 },
    expect: {
      mustMentionAny: ["edge", "setup", "product", "ticker"],
      mustCallAny: ["get_live_multiproduct_board"],
    },
  },
  {
    id: "board-urgency",
    desk: "cross-product",
    q: "What should I trade urgently across all platforms?",
    tool: "get_live_multiproduct_board",
    input: { metric: "urgency", limit: 3 },
    expect: {
      mustMentionAny: ["urgent", "trade", "setup"],
      mustCallAny: ["get_live_multiproduct_board"],
      mayBeInsufficient: true,
    },
  },
  {
    id: "board-confidence",
    desk: "cross-product",
    q: "Rank the highest-confidence setups across all desks",
    tool: "get_live_multiproduct_board",
    input: { metric: "confidence", limit: 5 },
    expect: {
      mustMentionAny: ["confidence", "setup"],
      mustCallAny: ["get_live_multiproduct_board"],
    },
  },
  {
    id: "board-lookahead",
    desk: "cross-product",
    q: "What setups expire in the next 4 hours across all desks?",
    tool: "get_live_multiproduct_board",
    input: { metric: "score", hours_ahead: 4, limit: 5 },
    expect: {
      mustMentionAny: ["expire", "hours", "setup"],
      mustCallAny: ["get_live_multiproduct_board"],
      mayBeInsufficient: true,
    },
  },

  // ── Tier 3: Conflicting signals & edge cases ──────────────────────────────────────────
  {
    id: "conflicting-directions",
    desk: "cross-product",
    q: "Which desks are bullish on SPX and which are bearish?",
    tool: "get_cross_product_ranking",
    input: { ticker: "SPX", direction: "bull", timeframe: "weekly", metric: "edge" },
    expect: {
      mustMentionAny: ["bullish", "bearish", "SPX"],
      mayBeInsufficient: false, // this should definitely answer
    },
  },
  {
    id: "thin-data-ticker",
    desk: "cross-product",
    q: "Cross-product ranking for $1 penny stock AABB",
    tool: "get_cross_product_ranking",
    input: { ticker: "AABB", direction: "bull", timeframe: "0dte", metric: "edge" },
    expect: {
      // This should gracefully degrade - either insufficient data or honest zero-edge answers
      mayBeInsufficient: true,
    },
  },
  {
    id: "far-out-timeframe",
    desk: "cross-product",
    q: "Compare monthly plays on IWM across all desks",
    tool: "get_cross_product_ranking",
    input: { ticker: "IWM", direction: "bull", timeframe: "monthly", metric: "edge" },
    expect: {
      mustMentionAny: ["IWM", "monthly"],
      mayBeInsufficient: true,
    },
  },

  // ── Tier 4: Multi-question synthesis (should decline or answer honestly) ────────────────
  {
    id: "synthesis-question",
    desk: "cross-product",
    q: "If Vector says play TSLA 0DTE but Thermal says stay away, which do I trust and why?",
    tool: "both", // should use cross-product-ranking to evaluate both
    input: { ticker: "TSLA", direction: "call", timeframe: "0dte", metric: "confidence" },
    expect: {
      mustMentionAny: ["Vector", "Thermal", "TSLA", "confidence"],
      mayBeInsufficient: false,
    },
  },
];

async function fetchWithAuth(endpoint, method = "GET", body = null, session = null) {
  const url = `${BASE}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (session?.cookie) {
    headers["Cookie"] = session.cookie;
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      data: text ? JSON.parse(text) : null,
      headers: Object.fromEntries(res.headers),
    };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

async function testQuestion(q, session) {
  const { id, desk, q: question, tool, input, expect: exp } = q;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`[${id}] ${question}`);
  console.log(`Tool: ${tool} | Input: ${JSON.stringify(input)}`);

  const t0 = Date.now();
  let result;

  try {
    // For now, test these as part of a Largo query to see how they integrate
    // In a real scenario, you could call the API endpoint directly
    result = await fetchWithAuth(`/api/market/largo/query`, "POST", { query: question }, session);

    const ms = Date.now() - t0;
    const verdict = [];

    if (!result.ok) {
      verdict.push(`FAILED (HTTP ${result.status})`);
    } else if (result.data?.error) {
      verdict.push(`ANSWER_DECLINED: ${result.data.error}`);
      if (exp.mayBeInsufficient) {
        verdict.push("✓ (acceptable for insufficient data)");
      }
    } else {
      const answer = result.data?.answer || "";
      const toolsUsed = result.data?.tools_used || [];

      // Check for required tools
      const calledRequired = exp.mustCallAny?.some((t) => toolsUsed.includes(t));
      if (exp.mustCallAny && !calledRequired) {
        verdict.push(`TOOL_MISS: needed one of [${exp.mustCallAny.join(", ")}], got [${toolsUsed.join(", ")}]`);
      } else if (calledRequired) {
        verdict.push(`✓ called required tools`);
      }

      // Check for required mentions
      const mentionedRequired = exp.mustMentionAny?.some((m) =>
        answer.toLowerCase().includes(m.toLowerCase())
      );
      if (exp.mustMentionAny && !mentionedRequired) {
        verdict.push(`MENTION_MISS: needed one of [${exp.mustMentionAny.join(", ")}]`);
      } else if (mentionedRequired) {
        verdict.push(`✓ mentioned key terms`);
      }

      // Length and completeness
      const ansLength = answer.length;
      if (ansLength > 500) {
        verdict.push(`✓ answer length ${ansLength}ch`);
      } else if (ansLength > 50) {
        verdict.push(`⚠ short answer ${ansLength}ch`);
      } else {
        verdict.push(`✗ too short ${ansLength}ch`);
      }

      if (exp.mayBeInsufficient && ansLength < 100) {
        verdict.push("✓ (acceptable insufficient data response)");
      }

      if (!verdict.some((v) => v.includes("MISS"))) {
        console.log(`[${ms}ms] ✓ PASS\n  ${verdict.join("\n  ")}`);
      } else {
        console.log(`[${ms}ms] ✗ FAIL\n  ${verdict.join("\n  ")}`);
      }

      if (answer) console.log(`  Answer: ${answer.slice(0, 400)}${answer.length > 400 ? "..." : ""}`);
    }
  } catch (err) {
    console.log(`✗ ERROR: ${err.message}`);
  }
}

async function main() {
  console.log("🚀 LARGO CROSS-PRODUCT STRESS TEST");
  console.log(`Base: ${BASE}`);

  let session;
  try {
    console.log("Minting temp Clerk session...");
    session = await mintClerkPremiumSession();
    console.log(`✓ Authenticated as ${session.userId}`);

    const start = Date.now();
    const results = { passed: 0, failed: 0, error: 0 };

    for (const q of QUESTIONS) {
      await testQuestion(q, session);
      results.passed++;
      // Rate limit ourselves
      await new Promise((r) => setTimeout(r, 500));
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n${"=".repeat(80)}`);
    console.log(`✓ Cross-product stress test complete (${elapsed}s)`);
    console.log(`Results: ${results.passed} asked`);
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exit(1);
  } finally {
    if (session?.cleanup) {
      try {
        await session.cleanup();
      } catch (e) {
        console.warn("Cleanup warning:", e.message);
      }
    }
  }
}

main().catch(console.error);
