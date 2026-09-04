#!/usr/bin/env node
import { writeJsonAtomic } from "./lib/state.mjs";
import { heartbeatPath } from "./lib/paths.mjs";
import { randomUUID } from "node:crypto";

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
const heartbeat = {
  agent: args.agent,
  run_id: runId,
  last_seen: new Date().toISOString(),
  last_productive_action: args.action ?? args.last_productive_action ?? "heartbeat",
  current_task: args.task ?? args.current_task ?? null,
  current_phase: args.phase ?? args.current_phase ?? "IDLE",
  branch: args.branch ?? null,
  pr: args.pr ? Number(args.pr) : null,
  healthy: args.healthy !== "false",
};
writeJsonAtomic(heartbeatPath(args.agent), heartbeat);
console.log(`[blackout-agent] heartbeat ${args.agent} task=${heartbeat.current_task} phase=${heartbeat.current_phase}`);
