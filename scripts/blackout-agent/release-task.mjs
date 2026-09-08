#!/usr/bin/env node
import { releaseLock } from "./lib/locks.mjs";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";

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
if (!taskId) process.exit(1);

const result = releaseLock(taskId, owner);
if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(2);
}

const state = readAgentState();
if (state.tasks[taskId]) {
  state.tasks[taskId].phase = "RELEASED";
  state.tasks[taskId].released_at = new Date().toISOString();
}
appendEvent(state, { type: "task_released", task_id: taskId, owner });
writeAgentState(state);
console.log(JSON.stringify({ ok: true, released: result.released }, null, 2));
