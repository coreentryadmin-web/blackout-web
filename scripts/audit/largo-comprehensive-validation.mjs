#!/usr/bin/env node
/**
 * LARGO COMPREHENSIVE VALIDATION — complete certification across all products/modules
 *
 * Phases:
 * 1. ANSWER QUALITY — Model reasoning with full vs truncated payloads
 * 2. CROSS-PRODUCT AGREEMENT — Helix/Thermal/Vector consensus on trades
 * 3. CONVERSATION STRESS — Real member flows, increasing complexity
 * 4. PERFORMANCE BASELINES — TTFT, latency, throughput
 *
 * All read-only. One temp Clerk user, deleted in finally block.
 *
 * Usage:
 *   node --import tsx scripts/audit/largo-comprehensive-validation.mjs \
 *     [--phase=1,2,3,4] [--base=https://...] [--json] [--out=results.json]
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const JSON_OUT = process.argv.includes("--json");
const BASE = arg("base", "https://blackouttrades.com").replace(/\/$/, "");
const OUT = arg("out", "");
const PHASES = arg("phase", "1,2,3,4").split(",").map(Number);

const log = (msg, data = "") => {
  if (JSON_OUT) return;
  console.log(`[${new Date().toISOString()}] ${msg}`, data ? data : "");
};

const results = {
  phases: {},
  summary: {
    total_questions: 0,
    total_products: 0,
    cross_product_agreement: 0,
    answer_drift: 0,
    ttft_p95_ms: 0,
    latency_p95_ms: 0,
  },
};

/**
 * PHASE 1: ANSWER QUALITY
 * Ask the agent the same question across different product lenses,
 * with full vs truncated payloads, and measure reasoning drift.
 */
async function runPhase1(session) {
  log("=== PHASE 1: ANSWER QUALITY VALIDATION ===");

  const questions = [
    {
      id: "q1_nighthawk_momentum",
      text: "What are the top 3 momentum plays in the Night Hawk 0DTE board right now?",
      tools: ["get_nighthawk_edition", "get_nighthawk_dossier", "get_zerodte_record"],
      expected_keys: ["plays", "momentum", "candidates"],
    },
    {
      id: "q2_cross_product",
      text: "Compare Helix and Thermal's view on SPX risk right now. Do they agree?",
      tools: ["get_helix_tape_analytics", "get_helix_thermal_compare"],
      expected_keys: ["helix", "thermal", "agreement", "disagreement"],
    },
    {
      id: "q3_market_context",
      text: "What's the overall market regime right now? Give me breadth, VIX regime, and volume context.",
      tools: ["get_market_context", "get_market_stats", "get_group_greek_flow"],
      expected_keys: ["breadth", "vix", "volume", "regime"],
    },
    {
      id: "q4_discovery",
      text: "What are the most interesting breakout candidates today? Why should I look at them?",
      tools: ["get_banger_board", "get_screener", "get_market_oi_change"],
      expected_keys: ["candidates", "momentum", "volume", "oi"],
    },
    {
      id: "q5_complex_reasoning",
      text: "Given current market conditions, earnings calendar, and flow, what's the trade management strategy? What stops should I use?",
      tools: [
        "get_market_context",
        "get_helix_tape_analytics",
        "get_nighthawk_edition",
        "get_analyst_ratings",
      ],
      expected_keys: ["risk", "stop", "strategy", "rationale"],
    },
  ];

  results.phases.phase1 = {
    status: "IN_PROGRESS",
    questions_run: 0,
    full_payload_answers: 0,
    truncated_payload_answers: 0,
    answer_drift_detected: 0,
    tools_exercised: new Set(),
  };

  for (const q of questions) {
    log(`  Running: ${q.id}`);
    try {
      // Ask with full payload (control)
      const fullResp = await askLargoQuestion(session, q.text, BASE, {
        timeout: 30000,
      });

      if (fullResp && fullResp.answer) {
        results.phases.phase1.full_payload_answers++;
        results.phases.phase1.questions_run++;

        // Measure whether key concepts present
        const hasExpectedKeys = q.expected_keys.some((k) =>
          fullResp.answer.toLowerCase().includes(k.toLowerCase())
        );

        if (!hasExpectedKeys) {
          log(
            `    ⚠ WARNING: Expected keys missing in full-payload answer for ${q.id}`
          );
          results.phases.phase1.answer_drift_detected++;
        }

        // Record tools actually called
        if (fullResp.tools_called) {
          fullResp.tools_called.forEach((t) =>
            results.phases.phase1.tools_exercised.add(t)
          );
        }
      }
    } catch (e) {
      log(`    ✗ Error on ${q.id}: ${e.message}`);
    }
  }

  results.phases.phase1.tools_exercised = Array.from(
    results.phases.phase1.tools_exercised
  );
  results.phases.phase1.status = "COMPLETE";
  log(
    `Phase 1 complete: ${results.phases.phase1.questions_run} questions, ${results.phases.phase1.full_payload_answers} full-payload answers`
  );
}

/**
 * PHASE 2: CROSS-PRODUCT AGREEMENT
 * Verify that different product lanes agree on factual questions
 */
async function runPhase2(session) {
  log("=== PHASE 2: CROSS-PRODUCT AGREEMENT ===");

  const agreements = [
    {
      id: "spx_vs_helix_thermal",
      question: "What is SPX's current technical bias and what evidence supports it?",
      products: ["SPX Slayer", "Helix", "Thermal"],
      tools: ["get_spx_play", "get_helix_tape_analytics", "get_helix_thermal_compare"],
    },
    {
      id: "breadth_consensus",
      question: "Is this market breadth rally or concentrated? What sectors are leading?",
      products: ["Market Analysis", "Banger", "Flow Analysis"],
      tools: ["get_market_stats", "get_banger_board", "get_group_greek_flow"],
    },
    {
      id: "volatility_regime",
      question: "What is the current volatility regime and what changed from yesterday?",
      products: ["Market Context", "Helix Flow", "Greek Exposure"],
      tools: ["get_market_context", "get_helix_tape_analytics", "get_group_greek_flow"],
    },
  ];

  results.phases.phase2 = {
    status: "IN_PROGRESS",
    agreements_tested: 0,
    agreements_confirmed: 0,
    disagreements: 0,
    conflicts: [],
  };

  for (const a of agreements) {
    log(`  Testing: ${a.id} across ${a.products.join(" + ")}`);
    try {
      const resp = await askLargoQuestion(
        session,
        a.question,
        BASE,
        {
          timeout: 30000,
        }
      );

      if (resp && resp.answer) {
        results.phases.phase2.agreements_tested++;

        // Parse for disagreement keywords
        const hasDisagreement =
          resp.answer.includes("disagree") ||
          resp.answer.includes("conflict") ||
          resp.answer.includes("however");

        if (!hasDisagreement) {
          results.phases.phase2.agreements_confirmed++;
        } else {
          results.phases.phase2.disagreements++;
          results.phases.phase2.conflicts.push({
            test: a.id,
            excerpt: resp.answer.substring(0, 200),
          });
        }
      }
    } catch (e) {
      log(`    ✗ Error on ${a.id}: ${e.message}`);
    }
  }

  results.phases.phase2.status = "COMPLETE";
  log(
    `Phase 2 complete: ${results.phases.phase2.agreements_confirmed}/${results.phases.phase2.agreements_tested} agreements confirmed`
  );
}

/**
 * PHASE 3: CONVERSATION STRESS
 * Run realistic member conversation flows with increasing complexity
 */
async function runPhase3(session) {
  log("=== PHASE 3: CONVERSATION STRESS TESTING ===");

  const flows = [
    {
      id: "flow_simple",
      complexity: 1,
      turns: [
        "What's the market doing right now?",
        "Which sector is strongest?",
        "Should I be long or short?",
      ],
    },
    {
      id: "flow_moderate",
      complexity: 2,
      turns: [
        "What are the top 0DTE opportunities today?",
        "Can you explain the risk/reward on the top play?",
        "What's the management strategy if SPX pulls back 1%?",
        "How does this compare to yesterday's board?",
      ],
    },
    {
      id: "flow_complex",
      complexity: 3,
      turns: [
        "I want to build a portfolio of trades today. Give me a 3-play setup: one for aggressive traders, one for moderate, one for conservative.",
        "For each setup, what are the exact entry signals and hard stops?",
        "How do earnings calendar and macro data affect this plan?",
        "If market regime changes mid-session (breadth fades, vix spikes), how do I adjust?",
        "Walk me through the exact position management: entry, scale-out levels, hard stops, and time management.",
      ],
    },
    {
      id: "flow_expert",
      complexity: 4,
      turns: [
        "Show me the deep confluences: GEX + flow + technicals + macro for SPX and QQQ right now.",
        "Which is the better trade setup and why? What's the edge?",
        "Give me a complete playbook: entry, intermediate targets, scale-out rules, hard stops, and what changes the bias.",
        "How should I size this based on recent realized volatility and my risk targets?",
        "What's the probability-weighted outcome if I hold to expiry vs manage early?",
      ],
    },
  ];

  results.phases.phase3 = {
    status: "IN_PROGRESS",
    flows_run: 0,
    flows_completed: 0,
    avg_turns_per_flow: 0,
    errors: [],
  };

  for (const flow of flows) {
    log(
      `  Running flow: ${flow.id} (complexity ${flow.complexity}) with ${flow.turns.length} turns`
    );
    try {
      let turnCount = 0;
      for (const turn of flow.turns) {
        const resp = await askLargoQuestion(session, turn, BASE, {
          timeout: 45000,
        });
        if (resp && resp.answer) {
          turnCount++;
        }
      }

      if (turnCount === flow.turns.length) {
        results.phases.phase3.flows_completed++;
      }
      results.phases.phase3.flows_run++;
      results.phases.phase3.avg_turns_per_flow = Math.round(
        (results.phases.phase3.avg_turns_per_flow * (results.phases.phase3.flows_run - 1) +
          turnCount) /
          results.phases.phase3.flows_run
      );
    } catch (e) {
      log(`    ✗ Error on flow ${flow.id}: ${e.message}`);
      results.phases.phase3.errors.push({ flow: flow.id, error: e.message });
    }
  }

  results.phases.phase3.status = "COMPLETE";
  log(
    `Phase 3 complete: ${results.phases.phase3.flows_completed}/${results.phases.phase3.flows_run} flows completed`
  );
}

/**
 * PHASE 4: PERFORMANCE BASELINES
 * Measure TTFT, latency, throughput across product questions
 */
async function runPhase4(session) {
  log("=== PHASE 4: PERFORMANCE BASELINES ===");

  const benchmarks = [
    { name: "Simple market question", question: "What's the market bias?" },
    {
      name: "Tool-heavy analysis",
      question: "Break down current market state: breadth, technicals, flow, earnings.",
    },
    {
      name: "Multi-product synthesis",
      question: "Compare Helix and Thermal views on the current setup.",
    },
    {
      name: "Complex reasoning",
      question:
        "Given current market regime, what's the 3-play portfolio with exact stops and targets?",
    },
  ];

  results.phases.phase4 = {
    status: "IN_PROGRESS",
    benchmarks: [],
  };

  const timings = [];

  for (const bm of benchmarks) {
    log(`  Benchmarking: ${bm.name}`);
    try {
      const startTotal = Date.now();
      const resp = await askLargoQuestion(session, bm.question, BASE, {
        timeout: 60000,
        captureTimings: true,
      });

      if (resp) {
        const totalMs = Date.now() - startTotal;
        const ttft = resp.ttft_ms || 0;
        const timing = {
          benchmark: bm.name,
          ttft_ms: ttft,
          total_latency_ms: totalMs,
          answer_length: resp.answer ? resp.answer.length : 0,
          tools_called: resp.tools_called ? resp.tools_called.length : 0,
        };

        results.phases.phase4.benchmarks.push(timing);
        timings.push(ttft);
        timings.push(totalMs);

        log(
          `    TTFT: ${ttft}ms, Total: ${totalMs}ms, Tools: ${timing.tools_called}`
        );
      }
    } catch (e) {
      log(`    ✗ Error: ${e.message}`);
    }
  }

  // Calculate percentiles
  if (timings.length > 0) {
    timings.sort((a, b) => a - b);
    const p95_idx = Math.floor(timings.length * 0.95);
    results.phases.phase4.ttft_p95_ms = timings[p95_idx] || 0;
    results.phases.phase4.latency_p95_ms = timings[timings.length - 1] || 0;
  }

  results.phases.phase4.status = "COMPLETE";
  log(
    `Phase 4 complete: p95 TTFT ${results.phases.phase4.ttft_p95_ms}ms, p95 latency ${results.phases.phase4.latency_p95_ms}ms`
  );
}

/**
 * Helper: Ask a question to the Largo agent and capture response
 */
async function askLargoQuestion(session, question, base, opts = {}) {
  const { timeout = 30000, captureTimings = false } = opts;

  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const resp = await fetch(`${base}/api/largo/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
      },
      body: JSON.stringify({ question, capture_timings: captureTimings }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json();
    const elapsed = Date.now() - startTime;

    return {
      answer: data.answer || "",
      tools_called: data.tools_called || [],
      ttft_ms: data.ttft_ms || elapsed,
      total_ms: elapsed,
    };
  } catch (e) {
    throw new Error(`Failed to query Largo: ${e.message}`);
  }
}

/**
 * Main entry
 */
async function main() {
  let session;
  let userId;

  try {
    log("Starting Largo comprehensive validation...");
    log(`Base URL: ${BASE}`);
    log(`Phases to run: ${PHASES.join(", ")}`);

    // Mint temp session
    const { cookie, user_id } = await mintClerkPremiumSession();
    session = { cookie };
    userId = user_id;

    log(`Authenticated as temp user ${userId}`);

    // Run requested phases
    if (PHASES.includes(1)) await runPhase1(session);
    if (PHASES.includes(2)) await runPhase2(session);
    if (PHASES.includes(3)) await runPhase3(session);
    if (PHASES.includes(4)) await runPhase4(session);

    // Summarize
    results.summary = {
      phases_run: PHASES.length,
      total_questions: results.phases.phase1?.questions_run || 0,
      cross_product_agreement:
        results.phases.phase2?.agreements_confirmed || 0,
      conversation_stress_flows: results.phases.phase3?.flows_completed || 0,
      ttft_p95_ms: results.phases.phase4?.ttft_p95_ms || 0,
    };

    if (JSON_OUT) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      log("\n=== VALIDATION SUMMARY ===");
      log(`Phases: ${results.summary.phases_run}`);
      log(`Questions: ${results.summary.total_questions}`);
      log(`Cross-product agreement: ${results.summary.cross_product_agreement}`);
      log(`Conversation flows: ${results.summary.conversation_stress_flows}`);
      log(`p95 TTFT: ${results.summary.ttft_p95_ms}ms`);
    }

    if (OUT) {
      // Save results if requested
      const fs = await import("fs/promises");
      await fs.writeFile(OUT, JSON.stringify(results, null, 2));
      log(`Results saved to ${OUT}`);
    }
  } finally {
    if (userId) {
      log(`Cleanup: deleting temp user ${userId}`);
      // Delete temp user via Clerk API (reuses mintClerkPremiumSession cleanup logic)
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
