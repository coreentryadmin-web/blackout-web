#!/usr/bin/env node
import { claimLock } from "./lib/locks.mjs";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";
import { withStateLock } from "./lib/state-lock.mjs";

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      out[k.replace(/-/g, "_")] = v ?? true;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const taskId = args.id ?? args.task_id;
const owner = args.owner ?? process.env.BLACKOUT_AGENT ?? "cursor";
if (!taskId) {
  console.error("Usage: claim-task.mjs --id=BO-P1-0001 --owner=cursor");
  process.exit(1);
}

const result = claimLock(taskId, owner, {
  phase: args.phase,
  branch: args.branch,
  pr: args.pr ? Number(args.pr) : undefined,
  reviewer: args.reviewer,
  runId: args.run_id ?? process.env.BLACKOUT_RUN_ID,
  leaseMs: args.lease_ms ? Number(args.lease_ms) : undefined,
});

if (!result.ok) {
  console.error(JSON.stringify({ ok: false, ...result }, null, 2));
  process.exit(2);
}

const stateResult = withStateLock(() => {
  const state = readAgentState();
  state.tasks[taskId] = { ...result.lock, title: args.title ?? state.tasks[taskId]?.title ?? null };
  state.agents[owner] = { ...(state.agents[owner] ?? {}), status: "active", last_seen: new Date().toISOString(), current_task: taskId };
  appendEvent(state, { type: "task_claimed", task_id: taskId, owner });
  writeAgentState(state);
  return state;
}, { owner });

if (!stateResult.ok) {
  console.error(JSON.stringify(stateResult, null, 2));
  process.exit(3);
}

console.log(JSON.stringify({ ok: true, lock: result.lock }, null, 2));
