#!/usr/bin/env node
/**
 * Unified session entry: sync → bootstrap report → heartbeat → resume leases.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncContext } from "./sync-context.mjs";
import { readJson, writeJsonAtomic } from "./lib/state.mjs";
import { heartbeatPath } from "./lib/paths.mjs";
import { renewLock, readLock } from "./lib/locks.mjs";

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
const runId = process.env.BLACKOUT_RUN_ID ?? randomUUID();
process.env.BLACKOUT_RUN_ID = runId;

const { state, activeLocks } = await syncContext();
const myLocks = Object.entries(activeLocks).filter(([, l]) => l.owner === args.agent);

for (const [taskId] of myLocks) {
  renewLock(taskId, args.agent, { runId, phase: readLock(taskId)?.phase ?? "RESUMED" });
}

const heartbeat = {
  agent: args.agent,
  run_id: runId,
  last_seen: new Date().toISOString(),
  last_productive_action: "session_start",
  current_task: myLocks[0]?.[0] ?? null,
  current_phase: myLocks.length ? "RESUMED" : "DISCOVERY",
  branch: args.branch ?? null,
  pr: args.pr ? Number(args.pr) : null,
  healthy: true,
};
writeJsonAtomic(heartbeatPath(args.agent), heartbeat);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const bootstrap = spawnSync("node", ["scripts/blackout-agent/bootstrap.mjs", `--agent=${args.agent}`], {
  encoding: "utf8",
  cwd: repoRoot,
});

const report = {
  ok: true,
  agent: args.agent,
  run_id: runId,
  resumed_tasks: myLocks.map(([id, l]) => ({ id, ...l })),
  heartbeat,
  bootstrap: bootstrap.stdout ? JSON.parse(bootstrap.stdout) : null,
  deploy: state.deploy,
};
console.log(JSON.stringify(report, null, 2));
