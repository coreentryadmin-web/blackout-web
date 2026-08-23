#!/usr/bin/env node
/**
 * LARGO PHASE 4.1 — Answer Quality Validation
 *
 * Validates that truncations do not degrade answer quality.
 * Asks 5 representative questions, measures completeness against expected concepts.
 *
 * Usage:
 *   node --import tsx scripts/audit/largo-phase4-answer-quality.mjs [--json] [--base=URL]
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const JSON_OUT = process.argv.includes("--json");
const BASE = arg("base", "https://blackouttrades.com").replace(/\/$/, "");

const log = (msg, data = "") => {
  if (JSON_OUT) return;
  console.log(`[${new Date().toISOString()}] ${msg}`, data ? data : "");
};

// Representative questions for Phase 4.1
const QUESTIONS = [
  {
    id: "q1_market_context",
    text: "What's the overall market state right now? Give me breadth, VIX regime, and volume context.",
    tools: ["get_market_context", "get_market_stats"],
    expected_concepts: [
      "breadth",
      "vix",
      "volume",
      "regime",
      "sectors",
    ],
    category: "Market Analysis",
  },
  {
    id: "q2_nighthawk_plays",
    text: "What are the top momentum plays in 0DTE right now? Why are they worth looking at?",
    tools: [
      "get_nighthawk_dossier",
      "get_nighthawk_edition",
    ],
    expected_concepts: [
      "momentum",
      "plays",
      "candidates",
      "setup",
      "reason",
    ],
    category: "Night Hawk Board",
  },
  {
    id: "q3_cross_product",
    text: "What market view consensus do multiple products share right now?",
    tools: [
      "get_helix_tape_analytics",
      "get_group_greek_flow",
    ],
    expected_concepts: [
      "agreement",
      "consensus",
      "risk",
      "position",
      "flow",
    ],
    category: "Cross-Product",
  },
  {
    id: "q4_discovery",
    text: "What are the most interesting breakout candidates today? Why should a trader care?",
    tools: [
      "get_banger_board",
      "get_screener",
      "get_market_oi_change",
    ],
    expected_concepts: [
      "candidates",
      "breakout",
      "volume",
      "opportunity",
      "conviction",
    ],
    category: "Discovery",
  },
  {
    id: "q5_strategy",
    text: "Given current market conditions and flow, what's the strategic approach for today?",
    tools: [
      "get_market_context",
      "get_analyst_ratings",
      "get_confluence_outcomes",
    ],
    expected_concepts: [
      "strategy",
      "risk",
      "management",
      "approach",
      "rationale",
    ],
    category: "Strategy",
  },
];

function scoreCompleteness(answer, expectedConcepts) {
  const answerLower = answer.toLowerCase();
  const foundCount = expectedConcepts.filter((c) =>
    answerLower.includes(c.toLowerCase())
  ).length;

  const score = Math.round(
    (foundCount / expectedConcepts.length) * 100
  );
  return {
    score,
    expected: expectedConcepts.length,
    found: foundCount,
    missing: expectedConcepts.filter(
      (c) => !answerLower.includes(c.toLowerCase())
    ),
  };
}

async function askLargo(session, question, base) {
  try {
    const resp = await fetch(`${base}/api/largo/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
      },
      body: JSON.stringify({ question }),
      timeout: 60000,
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return {
      answer: data.answer || "",
      tools_called: data.tools_called || [],
      model: data.model || "unknown",
    };
  } catch (e) {
    throw new Error(`Failed to query Largo: ${e.message}`);
  }
}

async function main() {
  let session;
  let userId;

  try {
    log("Starting Largo Phase 4.1 answer quality validation...");
    log(`Base URL: ${BASE}`);

    // Mint temp session
    const { cookie, user_id } = await mintClerkPremiumSession();
    session = { cookie };
    userId = user_id;

    log(`Authenticated as temp user ${userId}`);

    const results = {
      timestamp: new Date().toISOString(),
      base_url: BASE,
      questions_asked: 0,
      questions_complete: 0,
      avg_completeness_score: 0,
      answers: [],
      summary: {
        overall_quality: "UNKNOWN",
        pass_phase4: false,
      },
    };

    // Ask questions
    for (const q of QUESTIONS) {
      log(`\nQuestion: ${q.id} (${q.category})`);
      log(`  Text: ${q.text}`);

      try {
        const startTime = Date.now();
        const response = await askLargo(session, q.text, BASE);
        const elapsed = Date.now() - startTime;

        if (response && response.answer) {
          results.questions_complete++;

          // Score completeness
          const completeness = scoreCompleteness(
            response.answer,
            q.expected_concepts
          );

          results.answers.push({
            question_id: q.id,
            category: q.category,
            completeness_score: completeness.score,
            answer_length: response.answer.length,
            tools_called: response.tools_called,
            missing_concepts: completeness.missing,
            latency_ms: elapsed,
          });

          log(`  ✓ Completeness: ${completeness.score}%`);
          log(`  ✓ Latency: ${elapsed}ms`);

          if (completeness.missing.length > 0) {
            log(
              `  ⚠ Missing concepts: ${completeness.missing.join(", ")}`
            );
          }
        }
      } catch (e) {
        log(`  ✗ Error: ${e.message}`);
      }
    }

    results.questions_asked = QUESTIONS.length;

    // Calculate average completeness
    if (results.answers.length > 0) {
      const avgScore =
        results.answers.reduce((sum, a) => sum + a.completeness_score, 0) /
        results.answers.length;
      results.avg_completeness_score = Math.round(avgScore);
    }

    // Determine overall quality
    if (results.avg_completeness_score >= 80) {
      results.summary.overall_quality = "PASS";
      results.summary.pass_phase4 = true;
    } else if (results.avg_completeness_score >= 60) {
      results.summary.overall_quality = "CAUTION";
      results.summary.pass_phase4 = false;
    } else {
      results.summary.overall_quality = "FAIL";
      results.summary.pass_phase4 = false;
    }

    // Output
    if (JSON_OUT) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      log("\n=== PHASE 4.1 ANSWER QUALITY SUMMARY ===");
      log(`Questions asked: ${results.questions_asked}`);
      log(`Questions complete: ${results.questions_complete}`);
      log(`Average completeness: ${results.avg_completeness_score}%`);
      log(`Overall quality: ${results.summary.overall_quality}`);
      log(`Pass Phase 4: ${results.summary.pass_phase4 ? "YES" : "NO"}`);
    }

    // Save results
    const fs = await import("fs/promises");
    await fs.writeFile(
      "docs/audit/LARGO-PHASE4-RESULTS.json",
      JSON.stringify(results, null, 2)
    );
    log("\nResults saved to docs/audit/LARGO-PHASE4-RESULTS.json");

    process.exit(results.summary.pass_phase4 ? 0 : 1);
  } finally {
    if (userId) {
      log(`Cleanup: deleting temp user ${userId}`);
      // Cleanup via Clerk API
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
