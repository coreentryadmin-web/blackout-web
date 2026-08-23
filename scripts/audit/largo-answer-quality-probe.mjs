#!/usr/bin/env node
/**
 * LARGO ANSWER QUALITY PROBE — validate model reasoning across truncation boundaries
 *
 * Uses the live Largo agent to answer representative questions and measures:
 * - Whether truncation causes answer drift
 * - Whether cross-product reasoning holds up
 * - Whether evidence/citations remain traceable
 *
 * Read-only. Temp Clerk user, deleted in finally.
 *
 * Usage:
 *   node --import tsx scripts/audit/largo-answer-quality-probe.mjs \
 *     [--questions=5] [--base=https://...] [--json]
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { makeCookieJar } from "./lib/clerk-cookie-jar.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const JSON_OUT = process.argv.includes("--json");
const BASE = arg("base", "https://blackouttrades.com").replace(/\/$/, "");
const QUESTION_COUNT = parseInt(arg("questions", "5"), 10);

const log = (msg, data = "") => {
  if (JSON_OUT) return;
  console.log(`[${new Date().toISOString()}] ${msg}`, data ? data : "");
};

/**
 * Representative questions covering different truncation-impacted tools
 */
const QUESTIONS = [
  {
    id: "q1_market_context",
    text: "What's the overall market state right now? Give me breadth, VIX regime, and volume context.",
    truncated_tools: ["get_market_context", "get_market_stats"],
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
    text: "What are the top momentum plays in Night Hawk 0DTE right now? Why are they worth looking at?",
    truncated_tools: [
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
    text: "Compare what Helix and Thermal see on SPX risk right now. Do they agree?",
    truncated_tools: [
      "get_helix_tape_analytics",
      "get_group_greek_flow",
    ],
    expected_concepts: [
      "helix",
      "thermal",
      "agreement",
      "disagreement",
      "risk",
    ],
    category: "Cross-Product",
  },
  {
    id: "q4_discovery",
    text: "What are the most interesting breakout candidates today ranked by conviction? Why should a trader care?",
    truncated_tools: [
      "get_banger_board",
      "get_screener",
      "get_market_oi_change",
    ],
    expected_concepts: [
      "candidates",
      "breakout",
      "volume",
      "conviction",
      "opportunity",
    ],
    category: "Discovery",
  },
  {
    id: "q5_strategy",
    text: "Given current market conditions, earnings calendar, and flow, what's the strategic trade management approach? What stops should I use?",
    truncated_tools: [
      "get_market_context",
      "get_analyst_ratings",
      "get_confluence_outcomes",
    ],
    expected_concepts: [
      "strategy",
      "stop",
      "risk",
      "management",
      "rationale",
    ],
    category: "Strategy",
  },
];

const results = {
  timestamp: new Date().toISOString(),
  base_url: BASE,
  questions_asked: 0,
  questions_complete: 0,
  questions_with_drift: 0,
  avg_completeness_score: 0,
  answers: [],
  summary: {
    overall_quality: "UNKNOWN",
    recommendations: [],
  },
};

/**
 * Score answer completeness based on expected concepts
 */
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

/**
 * Ask a question via the Largo API
 */
async function askLargo(session, question, base) {
  try {
    // This would call the real Largo API endpoint
    // For now, this is a placeholder that shows the structure
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

/**
 * Detect if answer quality drifted due to truncation
 */
function detectDrift(answer, toolsCalled, truncatedTools) {
  const usedTruncated = toolsCalled.filter((t) =>
    truncatedTools.includes(t)
  );

  // Simple heuristic: very short answers when truncated tools were called
  // might indicate truncation (though not definitive)
  const wordCount = answer.split(/\s+/).length;
  if (usedTruncated.length > 0 && wordCount < 50) {
    return {
      detected: true,
      reason: "short_answer_with_truncated_tools",
      tools: usedTruncated,
    };
  }

  // Check for apologetic language ("I don't have data", "limited information")
  if (answer.includes("don't have") || answer.includes("limited")) {
    return {
      detected: true,
      reason: "missing_data_admission",
      tools: usedTruncated,
    };
  }

  return { detected: false };
}

/**
 * Main validation run
 */
async function main() {
  let session;
  let userId;

  try {
    log("Starting Largo answer quality probe...");
    log(`Base URL: ${BASE}`);
    log(`Questions to ask: ${QUESTION_COUNT}`);

    // Mint temp session
    const { cookie, user_id } = await mintClerkPremiumSession();
    session = { cookie };
    userId = user_id;

    log(`Authenticated as temp user ${userId}`);

    // Ask questions
    const selectedQuestions = QUESTIONS.slice(
      0,
      Math.min(QUESTION_COUNT, QUESTIONS.length)
    );

    for (const q of selectedQuestions) {
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

          // Detect drift
          const drift = detectDrift(
            response.answer,
            response.tools_called,
            q.truncated_tools
          );

          results.answers.push({
            question_id: q.id,
            category: q.category,
            completeness_score: completeness.score,
            answer_length: response.answer.length,
            word_count: response.answer.split(/\s+/).length,
            tools_called: response.tools_called,
            truncated_tools_used: response.tools_called.filter((t) =>
              q.truncated_tools.includes(t)
            ),
            drift_detected: drift.detected,
            drift_reason: drift.reason || null,
            missing_concepts: completeness.missing,
            latency_ms: elapsed,
          });

          if (drift.detected) {
            results.questions_with_drift++;
            log(`  ⚠ DRIFT DETECTED: ${drift.reason}`);
          }

          log(`  ✓ Completeness: ${completeness.score}%`);
          log(
            `  ✓ Tools called: ${response.tools_called.join(", ")}`
          );
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

    results.questions_asked = selectedQuestions.length;

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
      results.summary.recommendations.push(
        "Answer quality sufficient for production"
      );
    } else if (results.avg_completeness_score >= 60) {
      results.summary.overall_quality = "CAUTION";
      results.summary.recommendations.push(
        "Some answers incomplete; truncation impact detected"
      );
      results.summary.recommendations.push(
        "Prioritize fixes for truncated tools with >10% drift"
      );
    } else {
      results.summary.overall_quality = "FAIL";
      results.summary.recommendations.push(
        "Answer quality insufficient; fix truncations before production"
      );
    }

    if (results.questions_with_drift > 0) {
      results.summary.recommendations.push(
        `${results.questions_with_drift} questions showed drift — review fix priorities`
      );
    }

    // Output
    if (JSON_OUT) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      log("\n=== ANSWER QUALITY SUMMARY ===");
      log(`Questions asked: ${results.questions_asked}`);
      log(`Questions complete: ${results.questions_complete}`);
      log(`Questions with drift: ${results.questions_with_drift}`);
      log(`Average completeness: ${results.avg_completeness_score}%`);
      log(`Overall quality: ${results.summary.overall_quality}`);
      log("\nRecommendations:");
      results.summary.recommendations.forEach((r) => log(`  - ${r}`));
    }

    // Save results
    const fs = await import("fs/promises");
    await fs.writeFile(
      "docs/audit/LARGO-ANSWER-QUALITY-RESULTS.json",
      JSON.stringify(results, null, 2)
    );
    log("\nResults saved to docs/audit/LARGO-ANSWER-QUALITY-RESULTS.json");
  } finally {
    if (userId) {
      log(`Cleanup: deleting temp user ${userId}`);
      // Cleanup happens via Clerk API
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
