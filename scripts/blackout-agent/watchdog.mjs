#!/usr/bin/env node
/**
 * Watchdog: mark stale agent heartbeats unhealthy; expire task leases.
 */
import { readdirSync, existsSync } from "node:fs";
import { HEARTBEAT_DIR } from "./lib/paths.mjs";
import { readJson, writeJsonAtomic } from "./lib/state.mjs";
import { expireStaleLocksSync } from "./lib/locks.mjs";
import { heartbeatPath } from "./lib/paths.mjs";

const STALE_MS = Number(process.env.BLACKOUT_HEARTBEAT_STALE_MS ?? 20 * 60 * 1000);

function parseArgs(argv) {
  const out = { stale_ms: STALE_MS };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--stale-ms=")) out.stale_ms = Number(arg.split("=")[1]);
  }
  return out;
}

const args = parseArgs(process.argv);
const now = Date.now();
const expiredLocks = expireStaleLocksSync();
const report = { expired_locks: expiredLocks, agents: {} };

if (existsSync(HEARTBEAT_DIR)) {
  for (const file of readdirSync(HEARTBEAT_DIR)) {
    if (!file.endsWith(".json")) continue;
    const agent = file.replace(/\.json$/, "");
    const path = heartbeatPath(agent);
    const hb = readJson(path, null);
    if (!hb) continue;
    const last = hb.last_seen ? Date.parse(hb.last_seen) : 0;
    const stale = !last || now - last > args.stale_ms;
    hb.healthy = !stale;
    if (stale) hb.stale_since = hb.stale_since ?? new Date().toISOString();
    writeJsonAtomic(path, hb);
    report.agents[agent] = { healthy: hb.healthy, last_seen: hb.last_seen, current_task: hb.current_task, stale };
  }
}

console.log(JSON.stringify(report, null, 2));
