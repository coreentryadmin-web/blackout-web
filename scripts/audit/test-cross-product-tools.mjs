#!/usr/bin/env node
/**
 * Local test of cross-product tools via runLargoQuery
 * (requires ANTHROPIC_API_KEY but not production auth)
 */
import { runLargoQuery } from "../../src/lib/largo-terminal.ts";

const questions = [
  "Which desk has the best setup on SPX right now? Compare Vector vs Night Hawk.",
  "Rank all products by confidence on a weekly NVDA call.",
  "Show me the top 5 setups across all desks by edge.",
  "What's the highest-confidence trade I can make across all platforms right now?",
  "Compare 0DTE edge on QQQ between Slayer and Thermal.",
  "Which products have bullish signals on $GLD and which are bearish?",
  "If I have 4 hours, what expires first across all desks?",
  "Which product has the worst accuracy on monthly puts?",
];

const userId = "local-test-user";
const sessionId = `test-${Date.now()}`;

async function testQuestion(question) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Q: ${question}`);

  const t0 = Date.now();
  try {
    const result = await runLargoQuery(question, sessionId, userId, []);
    const ms = Date.now() - t0;

    console.log(`✓ ${ms}ms | tools: ${result.tools_used.slice(0, 5).join(", ")}${result.tools_used.length > 5 ? "..." : ""}`);
    console.log(`  ticker: ${result.ticker || "none"} | envelope: ${result.envelope ? "yes" : "no"}`);

    if (result.envelope?.headline) {
      console.log(`  headline: ${result.envelope.headline.slice(0, 120)}`);
    }

    const answer = result.answer;
    console.log(`  answer (${answer.length}ch): ${answer.slice(0, 300)}${answer.length > 300 ? "..." : ""}`);

    // Check for hallucinations or obviously wrong data
    const hasCrossProduct = result.tools_used.some((t) =>
      t.includes("cross_product") || t.includes("multiproduct")
    );
    if (question.toLowerCase().includes("rank") && !hasCrossProduct && question.toLowerCase().includes("desk")) {
      console.log(`  ⚠ Question asks for cross-product ranking but didn't call cross-product tools`);
    }

    console.log(`  verification: ${result.verification.verified}/${result.verification.total}`);
  } catch (err) {
    console.error(`✗ ERROR: ${err.message}`);
  }

  // Rate limit
  await new Promise((r) => setTimeout(r, 1000));
}

async function main() {
  console.log("Testing cross-product tools via runLargoQuery...\n");

  for (const q of questions) {
    await testQuestion(q);
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("✓ Test complete");
}

main().catch(console.error);
