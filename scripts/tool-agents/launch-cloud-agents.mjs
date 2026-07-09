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
    `You are the dedicated **${tool}** tool agent for BlackOut Trades.`,
    `Read docs/ops/tool-agents/${tool}.md and docs/ops/TOOL-AGENT-PROGRAM.md.`,
    `During cash RTH (09:30–16:00 ET) run continuously: npm run validate:tool-agent:${tool} -- --wait-open`,
    `Your mission: (1) every number 100% correct, (2) matrix cells correct, (3) plays genuinely good,`,
    `(4) deep analysis on failed plays — why/how, (5) flow/data correctness, (6) latency <2s warm.`,
    `Write CTO reports to audit-output/tool-agents/${tool}/. On P1: fix → branch → PR → merge → re-validate until GREEN.`,
    `Do NOT ask the user. Append summary to docs/api-audit/OPEN-ISSUES.md each session.`,
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
