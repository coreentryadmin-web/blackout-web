#!/usr/bin/env node
/**
 * Launch one Cursor Cloud Agent per premium tool at RTH open.
 *
 * Usage:
 *   node scripts/tool-agents/launch-cloud-agents.mjs
 *   node scripts/tool-agents/launch-cloud-agents.mjs --tool=spx-slayer
 *
 * Requires: CURSOR_API_KEY
 */
import { TOOL_KEYS } from "./registry.mjs";

const REPO = "https://github.com/coreentryadmin-web/blackout-web";
const only = process.argv.find((a) => a.startsWith("--tool="))?.slice(7);
const keys = only ? [only] : TOOL_KEYS;

function promptFor(tool) {
  return [
    `You are the dedicated **${tool}** tool agent for BlackOut Trades. FULL AUTONOMY — no user prompts ever.`,
    `Read docs/ops/tool-agents/${tool}.md and docs/ops/TOOL-AGENT-PROGRAM.md and CLAUDE.md merge policy.`,
    `09:30–16:00 ET: run continuously in a loop:`,
    `  npm run validate:tool-agent:${tool} -- --wait-open`,
    `NEVER stop the monitor when you find P1 — log it, then FIX:`,
    `  diagnose → branch fix/${tool}-<slug> → commit → push → PR → gh pr merge --auto --squash --delete-branch`,
    `  poll Railway/ECS deploy → npm run validate:tool-agent:${tool} -- --once until GREEN → RESUME continuous loop`,
    `Mission: (1) every number correct (2) matrix cells correct (3) plays genuinely good`,
    `(4) failed plays deep-dive why/how (5) flow/data correctness (6) latency <2s warm.`,
    `Write audit-output/tool-agents/${tool}/cto-report-*.md and findings.ndjson every session.`,
    `Append summary to docs/api-audit/OPEN-ISSUES.md. Do NOT ask the user. Do NOT stop until 16:00 ET.`,
  ].join(" ");
}

async function launch(tool) {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    console.error("CURSOR_API_KEY required");
    process.exit(1);
  }
  const payload = JSON.stringify({
    prompt: { text: promptFor(tool) },
    repos: [{ url: REPO, startingRef: "main" }],
    autoCreatePR: true,
  });
  const res = await fetch("https://api.cursor.com/v1/agents", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: payload,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[${tool}] launch failed ${res.status}: ${text.slice(0, 300)}`);
    return false;
  }
  console.log(`[${tool}] launched: ${text.slice(0, 200)}`);
  return true;
}

for (const tool of keys) {
  await launch(tool);
}
