#!/usr/bin/env node
/**
 * One-off live Largo probe — local runLargoQuery (needs ANTHROPIC_API_KEY + optional DB/Redis).
 */
import { runLargoQuery } from "../../src/lib/largo-terminal.ts";

const QUESTIONS = process.argv.slice(2);
const defaults = [
  "What is NVDA doing right now?",
  "Why is SPX up today?",
  "Compare Helix flow vs Thermal GEX on SPX",
  "What's my best 0DTE play on TSLA?",
  "How many trades did we win last month?",
  "SPX?",
];
const qs = QUESTIONS.length ? QUESTIONS : defaults;
const userId = "local-audit-user";

for (const question of qs) {
  console.log("\n" + "=".repeat(80));
  console.log(`Q: ${question}`);
  const t0 = Date.now();
  try {
    const r = await runLargoQuery(question, `local-${Date.now()}`, userId, []);
    const ms = Date.now() - t0;
    console.log(
      `${ms}ms | tools (${r.tools_used.length}): ${r.tools_used.slice(0, 12).join(", ")}${r.tools_used.length > 12 ? "..." : ""}`
    );
    console.log(`Ticker: ${r.ticker} | envelope: ${r.envelope ? "yes" : "no"}`);
    if (r.envelope?.headline) console.log(`Headline: ${r.envelope.headline.slice(0, 200)}`);
    const ans = r.answer;
    console.log(`Answer (${ans.length} chars):\n${ans.slice(0, 2800)}${ans.length > 2800 ? "...[truncated]" : ""}`);
    console.log(
      `Verify: ${r.verification.verified}/${r.verification.total} (${Math.round((r.verification.coverage || 0) * 100)}%)`
    );
    if (r.verification.unverified?.length) {
      console.log(`Unverified sample: ${r.verification.unverified.slice(0, 5).join(" | ")}`);
    }
  } catch (e) {
    console.error("ERR:", e instanceof Error ? e.message : e);
  }
}
