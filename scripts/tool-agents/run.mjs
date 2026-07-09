#!/usr/bin/env node
/**
 * Run a dedicated tool agent (continuous RTH supervisor).
 *
 * Usage:
 *   npm run validate:tool-agent:spx-slayer
 *   node scripts/tool-agents/run.mjs thermal --once
 *   node scripts/tool-agents/run.mjs --list
 */
import { TOOL_AGENTS, TOOL_KEYS } from "./registry.mjs";
import { runAgentLoop } from "./_lib/base.mjs";

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const k of TOOL_KEYS) console.log(`${k} — ${TOOL_AGENTS[k].label}`);
  process.exit(0);
}

const key = args.find((a) => !a.startsWith("--"));
if (!key || !TOOL_AGENTS[key]) {
  console.error(`Usage: node scripts/tool-agents/run.mjs <${TOOL_KEYS.join("|")}> [--once] [--force] [--wait-open]`);
  process.exit(1);
}

const code = await runAgentLoop(TOOL_AGENTS[key], {
  once: args.includes("--once"),
  force: args.includes("--force"),
  waitOpen: args.includes("--wait-open"),
});
process.exit(code);
