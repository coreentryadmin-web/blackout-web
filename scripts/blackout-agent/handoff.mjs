#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";
import { withStateLock } from "./lib/state-lock.mjs";
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
const { state } = await syncContext();

const handoff = `# LAST HANDOFF — ${args.agent}\n\n**At:** ${new Date().toISOString()}\n**Run:** ${runId}\n\n## Summary\n\n${summary}\n\n## Deploy\n\n- main: \`${state.deploy.last_main_sha ?? "unknown"}\`\n- status: ${state.deploy.last_deploy_status ?? "unknown"}\n\n## Open PRs\n\n${(state.open_prs ?? []).map((p) => `- #${p.number} [${p.agent}] ${p.title}`).join("\n") || "_none_"}\n`;

writeFileSync(MARKDOWN_FILES.lastHandoff, handoff, "utf8");
const histDir = runHistoryDir(args.agent);
mkdirSync(histDir, { recursive: true });
writeFileSync(`${histDir}/${new Date().toISOString().replace(/[:.]/g, "-")}.md`, handoff, "utf8");

// BUG FIX (round 354): this used to call `appendEvent(state, ...)` + `writeAgentState(state)`
// directly on the `state` object `syncContext()` returned above — a plain, unlocked
// read(-earlier)-then-write with no participation in the shared `withStateLock` protocol at
// all. Any locked writer (`claim-task.mjs`/`release-task.mjs`/`record-review.mjs`) that commits
// a change in the window between `syncContext()` returning and this write would have that
// change silently erased the instant this stale snapshot was written back on top of it. Re-read
// fresh, inside the lock, right before appending the handoff event and writing — same fix as
// this PR's `sync-context.mjs`/`release-task.mjs` companions, same root cause.
const locked = withStateLock(() => {
  const fresh = readAgentState();
  appendEvent(fresh, { type: "handoff", agent: args.agent, run_id: runId, summary });
  writeAgentState(fresh);
  return fresh;
}, { owner: `handoff-${args.agent}` });

if (!locked.ok) {
  // The handoff markdown files above are already written — the only thing that didn't land is
  // this run's "handoff" event in AGENT_STATE.json. Surface it rather than hiding it, but don't
  // fail the whole handoff over a transient lock contention (the next sync/handoff recovers).
  console.error(JSON.stringify({ ok: false, warning: "handoff event not recorded", ...locked }, null, 2));
}
console.log(`[blackout-agent] handoff → ${MARKDOWN_FILES.lastHandoff}`);
