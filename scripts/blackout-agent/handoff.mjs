#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";
import { MARKDOWN_FILES, runHistoryDir } from "./lib/paths.mjs";
import { randomUUID } from "node:crypto";
import { syncContext } from "./sync-context.mjs";

function parseArgs(argv) {
  const out = { agent: process.env.BLACKOUT_AGENT ?? "cursor" };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      out[k.replace(/-/g, "_")] = v ?? true;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const runId = args.run_id ?? process.env.BLACKOUT_RUN_ID ?? randomUUID();
const summary = args.summary ?? "session handoff";
const { state } = syncContext();

const handoff = `# LAST HANDOFF — ${args.agent}\n\n**At:** ${new Date().toISOString()}\n**Run:** ${runId}\n\n## Summary\n\n${summary}\n\n## Deploy\n\n- main: \`${state.deploy.last_main_sha ?? "unknown"}\`\n- status: ${state.deploy.last_deploy_status ?? "unknown"}\n\n## Open PRs\n\n${(state.open_prs ?? []).map((p) => `- #${p.number} [${p.agent}] ${p.title}`).join("\n") || "_none_"}\n`;

writeFileSync(MARKDOWN_FILES.lastHandoff, handoff, "utf8");
const histDir = runHistoryDir(args.agent);
mkdirSync(histDir, { recursive: true });
writeFileSync(`${histDir}/${new Date().toISOString().replace(/[:.]/g, "-")}.md`, handoff, "utf8");
appendEvent(state, { type: "handoff", agent: args.agent, run_id: runId, summary });
writeAgentState(state);
console.log(`[blackout-agent] handoff → ${MARKDOWN_FILES.lastHandoff}`);
