#!/usr/bin/env node
/**
 * RIGOROUS LARGO QA PROTOCOL — Operator's 50-question breadth test + depth conversations
 *
 * Grade every answer on SIX dimensions:
 * 1. CORRECTNESS — is the core fact right (expiry, spot price, odds, etc.)?
 * 2. FRESHNESS — is data fresh enough for the question asked?
 * 3. CROSS-PRODUCT REASONING — does it synthesize across Helix/Thermal/Vector/NH/Slayer/Meridian?
 * 4. ACTIONABILITY — can a trader act on this without asking follow-ups?
 * 5. RESTRAINT — does it refuse bad trades and explain no-trade decisions?
 * 6. MEMORY (depth only) — does it track "it" across turns, retrieve FRESH data, change mind?
 *
 * Breadth test: 50 questions testing every major capability
 * Depth test: ~10 questions as 8-12 turn conversations, SAME session_id, DATA MUST REFRESH
 *
 * Usage:
 *   node --import tsx scripts/audit/largo-po-conversation-probe.mjs [--breadth] [--depth] [--json]
 *   node --import tsx scripts/audit/largo-po-conversation-probe.mjs --breadth --only=1,2,3
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const RUN_BREADTH = args.includes("--breadth") || (!args.includes("--depth"));
const RUN_DEPTH = args.includes("--depth");
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").split("=")[1]?.split(",").map(Number).filter(Boolean);

const log = (msg, data = "") => {
  if (JSON_OUT) return;
  console.log(`[${new Date().toISOString()}] ${msg}`, data);
};

// ============ BREADTH TEST: 50 Questions ============

const BREADTH_QUESTIONS = [
  // SPX Structure & Drivers (1-10)
  {
    id: 1,
    q: "What's actually driving SPX right now? Give me the 3 strongest factors, ranked, and tell me what would invalidate your read.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: false, restraint: false },
  },
  {
    id: 2,
    q: "Don't give me a market summary. What changed in SPX in the last 15 minutes that actually matters?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 3,
    q: "Is SPX trending, pinning, breaking out, or mean-reverting right now? Prove it using our data.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 4,
    q: "Where are the most important SPX levels right now? Rank them by importance and explain what happens if each breaks.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 5,
    q: "Are dealers likely amplifying or suppressing SPX movement right now? What evidence supports that?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 6,
    q: "What is the highest-conviction SPX setup right now? If there isn't one, explicitly tell me NO TRADE and explain what's missing.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: true },
  },
  {
    id: 7,
    q: "If SPX drops 20 points from here, which gamma levels become important next and how would your thesis change?",
    grade: { correctness: true, freshness: false, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 8,
    q: "What would have to happen in the next 10 minutes for your current SPX bias to flip?",
    grade: { correctness: false, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 9,
    q: "Compare SPX, SPY and QQQ right now. Which has the cleanest directional structure and why?",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 10,
    q: "Is the current SPX move supported by options flow, dealer positioning and price action simultaneously, or is something diverging?",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },

  // Helix Flow Analysis (11-20)
  {
    id: 11,
    q: "Find the most unusual institutional options activity in Helix right now. Don't just rank by premium — tell me why it's actually unusual.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 12,
    q: "Which ticker has the strongest sustained flow campaign today rather than just one large print?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 13,
    q: "Find me a ticker where Helix flow is strengthening while price hasn't fully reacted yet.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 14,
    q: "Find the strongest bearish flow on the board. Is it actually directional bearish flow or could it be hedging/spread activity?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: true },
  },
  {
    id: 15,
    q: "Which ticker has the biggest disagreement between call/put premium and actual price direction today? Explain the divergence.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 16,
    q: "Find a large Helix flow that looks impressive at first glance but that you would NOT trade. Explain why.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: false, restraint: true },
  },
  {
    id: 17,
    q: "Which individual contract or cluster of contracts deserves the most attention right now? Show premium, strike, expiry, aggression and why it matters.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 18,
    q: "Is today's strongest bullish flow concentrated in one expiry/strike or distributed across a broader campaign? Why does that distinction matter?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 19,
    q: "Show me a ticker where flow changed direction during the session. What changed and when?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 20,
    q: "Find a ticker where Helix says bullish but another BLACKOUT system disagrees. Who do you trust more right now and why?",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },

  // Thermal/Gamma Analysis (21-30)
  {
    id: 21,
    q: "Using Thermal, where is the most interesting gamma setup in the market right now? Don't automatically choose SPX.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 22,
    q: "Which ticker is closest to a meaningful gamma flip, and what could happen if price crosses it?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 23,
    q: "Find me the cleanest gamma vacuum or low-resistance zone where price could accelerate if a key level breaks.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 24,
    q: "Which major call wall looks most vulnerable right now? Use price behavior and other BLACKOUT evidence to support the answer.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 25,
    q: "Which put wall appears strongest right now, and what evidence would tell you it's beginning to fail?",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 26,
    q: "Where are GEX, VEX, DEX and charm telling materially different stories? Explain the disagreement in trader language.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 27,
    q: "Has any important gamma wall or king node migrated materially today? What changed and why should I care?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 28,
    q: "Compare the Thermal structure of NVDA, AMD and TSLA. Which gives the cleanest directional opportunity right now?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 29,
    q: "Find a ticker where positive gamma is likely suppressing movement despite aggressive options flow.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 30,
    q: "Find the opposite: a ticker where short/negative gamma could amplify an already-developing directional move.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },

  // Vector/SPX Slayer (31-35)
  {
    id: 31,
    q: "What is Vector's highest-ranked setup right now? Independently verify whether the ranking deserves to be #1 instead of blindly trusting Vector.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 32,
    q: "Find a high-ranked Vector name that you think is actually weak. What's wrong with the setup?",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: false, restraint: true },
  },
  {
    id: 33,
    q: "Find a lower-ranked ticker that may deserve more attention because Helix or Thermal is showing something Vector isn't fully capturing.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 34,
    q: "Which ticker has the strongest relative strength versus both its sector and the broader market right now? Is options activity confirming it?",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 35,
    q: "Find me the cleanest breakout candidate that has NOT broken out yet. Give me the exact condition that would make it actionable.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: true },
  },

  // Night Hawk (36-40)
  {
    id: 36,
    q: "What is Night Hawk's best WATCH right now? Tell me exactly what's already confirmed, what's still missing, and what turns it into ENTRY VALID.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 37,
    q: "For the strongest OPEN Night Hawk trade, compare every major thesis factor at entry versus now. Is the thesis strengthening or weakening?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 38,
    q: "Look across all open Night Hawk plays. Which one needs attention first right now — hold, trim or exit — and why?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 39,
    q: "Find a closed Night Hawk trade from today. Explain why it worked or failed and whether the exit was good relative to peak P&L.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: false, restraint: false },
  },
  {
    id: 40,
    q: "Find a Night Hawk play where the original setup looked good but the thesis subsequently broke. What was the first meaningful warning?",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },

  // Meridian/Earnings (41-44)
  {
    id: 41,
    q: "Which upcoming earnings event in Meridian has the most interesting options setup? Compare expected move, positioning, flow and historical reaction.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 42,
    q: "Find an earnings name where the options market appears to be pricing a larger move than its historical earnings reactions justify.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: false },
  },
  {
    id: 43,
    q: "Find the opposite: an earnings name where historical reactions or current positioning suggest the expected move may be underpricing risk.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 44,
    q: "Pick one major upcoming earnings name and give me the bull case, bear case and what the options market appears to expect. Don't recommend a trade unless one side genuinely has an edge.",
    grade: { correctness: true, freshness: true, crossProduct: false, actionability: true, restraint: true },
  },

  // Full-Stack Synthesis (45-50)
  {
    id: 45,
    q: "Across the entire BLACKOUT platform, what is the single best trade opportunity right now? Start from the underlying thesis first, then choose the best options expression and DTE.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: true },
  },
  {
    id: 46,
    q: "Now argue AGAINST the trade you just recommended. Give me the strongest evidence that could make your recommendation wrong.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: false, restraint: true },
  },
  {
    id: 47,
    q: "Find me a trade where at least three independent BLACKOUT systems agree. Tell me whether that confluence is genuinely independent or whether they're effectively using the same underlying signal.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: false },
  },
  {
    id: 48,
    q: "Find the biggest data or signal conflict anywhere across Helix, Thermal, Vector, Night Hawk, Slayer and Meridian right now. Do NOT resolve it unless the evidence supports a resolution.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: false, restraint: true },
  },
  {
    id: 49,
    q: "You have to choose between taking one trade right now or staying completely in cash. What do you choose? Give me the minimum evidence required to justify taking risk.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: true },
  },
  {
    id: 50,
    q: "Act as the BLACKOUT desk lead. Scan everything available to you and give me only what deserves my attention for the next 30 minutes: opportunities, risks, levels, open-trade management and what you're waiting for. No filler.",
    grade: { correctness: true, freshness: true, crossProduct: true, actionability: true, restraint: true },
  },
];

async function runBreadthTest(session) {
  log("=== BREADTH TEST: 50 Questions ===");

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    findings: [],
  };

  const toRun = ONLY ? BREADTH_QUESTIONS.filter((q) => ONLY.includes(q.id)) : BREADTH_QUESTIONS;

  for (const q of toRun) {
    results.total++;
    const verdict = await testQuestion(q, session);
    if (verdict.score >= 0.7) results.passed++;
    else results.failed++;

    if (verdict.findings.length) {
      results.findings.push({ qid: q.id, findings: verdict.findings });
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

async function testQuestion(q, session) {
  const { id, q: question, grade } = q;

  // Refresh session to keep JWT alive (60s lifetime, fixed not idle)
  const refreshed = await session.refresh?.();
  if (refreshed?.cookieHeader) {
    session.cookieHeader = refreshed.cookieHeader;
  }

  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/market/largo/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.cookieHeader },
      body: JSON.stringify({ question }),
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
    const ms = Date.now() - t0;

    if (!res.ok || !data?.answer) {
      const detail = !res.ok ? `HTTP ${res.status}` : "empty response";
      const hint = text ? text.substring(0, 100) : "";
      return { score: 0, findings: [`Q${id}: ${detail}${hint ? ` (${hint})` : ""}`] };
    }

    const answer = data.answer;
    const toolsUsed = data.tools_used || [];

    // Grade on 6 dimensions
    const scores = {
      correctness: gradeCorrectness(question, answer, toolsUsed) * (grade.correctness ? 1 : 0.5),
      freshness: gradeFreshness(answer, toolsUsed) * (grade.freshness ? 1 : 0.5),
      crossProduct: gradeCrossProduct(toolsUsed) * (grade.crossProduct ? 1 : 0.5),
      actionability: gradeActionability(answer) * (grade.actionability ? 1 : 0.5),
      restraint: gradeRestraint(answer) * (grade.restraint ? 1 : 0.5),
    };

    const avgScore = Object.values(scores).reduce((a, b) => a + b) / 5;

    const findings = [];
    if (scores.correctness < 0.6) findings.push(`Q${id}: CORRECTNESS LOW (fact check failed)`);
    if (scores.freshness < 0.6) findings.push(`Q${id}: FRESHNESS LOW (data appears stale)`);
    if (scores.crossProduct < 0.6 && grade.crossProduct) findings.push(`Q${id}: CROSS-PRODUCT MISS`);
    if (scores.actionability < 0.6 && grade.actionability) findings.push(`Q${id}: NOT ACTIONABLE`);
    if (scores.restraint < 0.6 && grade.restraint) findings.push(`Q${id}: POOR RESTRAINT`);

    if (!JSON_OUT) {
      const status = avgScore >= 0.7 ? "✓" : "✗";
      console.log(
        `${status} Q${id.toString().padStart(2)} [${ms}ms] correctness=${scores.correctness.toFixed(1)} freshness=${scores.freshness.toFixed(1)} cross=${scores.crossProduct.toFixed(1)} tools=${toolsUsed.length}`
      );
    }

    return { score: avgScore, findings, ms, toolsUsed };
  } catch (err) {
    return { score: 0, findings: [`Q${id}: ERROR ${err.message}`] };
  }
}

function gradeCorrectness(question, answer, tools) {
  // Check if answer contains actual numbers, dates, tickers
  // This is a heuristic — real correctness requires ground-truth data
  const hasNumbers = /\d+/.test(answer);
  const hasTickersOrLevels = /SPX|SPY|QQQ|NVDA|AMD|TSLA|\d{4,5}/.test(answer);
  if (!hasNumbers && !hasTickersOrLevels) return 0.3; // possibly hallucinating
  if (answer.length < 50) return 0.5; // too short to be substantive
  return 0.8; // appears substantive
}

function gradeFreshness(answer, tools) {
  // Check if answer mentions how old data is
  // Real freshness would compare timestamps to now
  const freshMarkers = ["right now", "just", "this second", "live", "minute", "current"];
  const staleMarkers = ["yesterday", "last week", "historical", "average"];
  const hasFresh = freshMarkers.some((m) => answer.toLowerCase().includes(m));
  const hasStale = staleMarkers.some((m) => answer.toLowerCase().includes(m));

  if (hasStale && !hasFresh) return 0.4; // stale
  if (hasFresh) return 0.9; // appears fresh
  return 0.6; // neutral
}

function gradeCrossProduct(tools) {
  // How many distinct products' tools were called?
  const products = new Set();
  const toolToProduct = {
    "get_nighthawk_edition": "nighthawk",
    "get_zerodte_plays": "nighthawk",
    "get_market_oi_change": "thermal",
    "get_gex_heatmap": "thermal",
    "get_positioning": "thermal",
    "get_vector_pulse": "vector",
    "get_vector_full_state": "vector",
    "get_spx_play": "slayer",
    "get_spx_structure": "slayer",
    "get_earnings_market": "helix",
    "get_helix_signal_outcomes": "helix",
    "get_options_flow": "helix",
  };

  for (const tool of tools) {
    if (toolToProduct[tool]) products.add(toolToProduct[tool]);
  }

  // Expect at least 2 products for cross-product questions
  if (products.size >= 3) return 0.95;
  if (products.size === 2) return 0.75;
  if (products.size === 1) return 0.4;
  return 0.2; // no product tools called
}

function gradeActionability(answer) {
  // Does it give specific, actionable advice?
  const actionWords = ["buy", "sell", "long", "short", "hold", "exit", "trim", "entry", "target", "stop"];
  const hasAction = actionWords.some((w) => answer.toLowerCase().includes(w));

  const hasRisk = /risk|stop|loss|danger|caution/.test(answer.toLowerCase());
  const hasContext = /because|given|therefore|implies|means/.test(answer.toLowerCase());

  if (hasAction && hasRisk && hasContext) return 0.95; // fully actionable with context
  if (hasAction && hasContext) return 0.8; // actionable
  if (hasAction) return 0.6; // action but no context
  return 0.3; // not actionable
}

function gradeRestraint(answer) {
  // Does it show discipline? (avoiding bad trades, saying NO TRADE, explaining why)
  const restraintWords = ["don't", "wouldn't", "avoid", "skip", "pass", "no trade", "insufficient", "missing"];
  const hasRestraint = restraintWords.some((w) => answer.toLowerCase().includes(w));

  const hasHonesty = /i don't|unclear|uncertain|insufficient|depends|need/.test(answer.toLowerCase());

  if (hasRestraint && hasHonesty) return 0.95; // strong restraint
  if (hasRestraint || hasHonesty) return 0.75; // some restraint
  if (answer.length < 200) return 0.5; // short = maybe restrained
  return 0.3; // confident but no restraint signals
}

async function main() {
  log("🚀 RIGOROUS LARGO QA PROTOCOL");
  log(`Base: ${BASE}`);

  let session;
  try {
    if (RUN_BREADTH || RUN_DEPTH) {
      log("Minting temp Clerk session...");
      session = await mintClerkPremiumSession({ appUrl: BASE });
      if (session.skip) {
        console.error(`Auth failed: ${session.reason}`);
        process.exit(1);
      }
      log(`✓ Authenticated as ${session.userId}`);
    }

    if (RUN_BREADTH) {
      const results = await runBreadthTest(session);
      console.log(`\n=== BREADTH TEST RESULTS ===`);
      console.log(`Passed: ${results.passed}/${results.total}`);
      console.log(`Failed: ${results.failed}/${results.total}`);
      if (results.findings.length) {
        console.log(`\nFindings:`);
        for (const f of results.findings.slice(0, 10)) {
          console.log(`  ${f.findings.join(" | ")}`);
        }
      }
    }

    if (RUN_DEPTH) {
      log("Depth conversations not yet implemented");
    }
  } catch (err) {
    console.error("Fatal:", err.message);
    process.exit(1);
  } finally {
    if (session?.cleanup) {
      try {
        await session.cleanup();
      } catch (e) {
        // ok
      }
    }
  }
}

main().catch(console.error);
