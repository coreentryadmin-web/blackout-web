#!/usr/bin/env node
/**
 * Guard against duplicate Cursor dispatches.
 *
 * IMPORTANT: The committed `.blackout-agent/HEARTBEAT/cursor.json` is NOT proof of a live
 * cloud-agent session — handoff PR merges update it and falsely block dispatch for 15min.
 * Default: allow dispatch. Opt-in heartbeat gate via BLACKOUT_DISPATCH_USE_HEARTBEAT=1.
 *
 * Exit 0 = safe to dispatch; exit 1 = skip.
 */
import { readJson } from "./lib/state.mjs";
import { heartbeatPath } from "./lib/paths.mjs";

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
const event = process.env.GITHUB_EVENT_NAME ?? "";
const ref = process.env.GITHUB_REF ?? "";

// Always wake after main moves — merge waves must not stall the worker.
if (event === "push" && ref === "refs/heads/main") {
  console.log(JSON.stringify({ ok: true, reason: "main_push_always_dispatch" }));
  process.exit(0);
}

// Scheduled fallback must never self-block.
if (event === "schedule" || event === "workflow_dispatch") {
  console.log(JSON.stringify({ ok: true, reason: "scheduled_dispatch" }));
  process.exit(0);
}

// Post-merge CI green on main — continue the work loop.
if (event === "workflow_run" && process.env.GITHUB_WORKFLOW_RUN_CONCLUSION === "success") {
  const branch = process.env.GITHUB_WORKFLOW_RUN_HEAD_BRANCH ?? "";
  if (branch === "main") {
    console.log(JSON.stringify({ ok: true, reason: "main_ci_success_dispatch" }));
    process.exit(0);
  }
}

if (args.force || process.env.BLACKOUT_DISPATCH_FORCE === "1") {
  console.log(JSON.stringify({ ok: true, reason: "forced" }));
  process.exit(0);
}

// Legacy opt-in heartbeat gate (off by default — committed heartbeat is not live state).
if (process.env.BLACKOUT_DISPATCH_USE_HEARTBEAT === "1") {
  const ACTIVE_MS = Number(process.env.BLACKOUT_DISPATCH_GUARD_MS ?? 3 * 60 * 1000);
  const hb = readJson(heartbeatPath("cursor"), null);
  const now = Date.now();
  if (hb?.last_seen) {
    const age = now - Date.parse(hb.last_seen);
    if (age < ACTIVE_MS && hb.healthy !== false) {
      console.log(JSON.stringify({ ok: false, reason: "cursor_session_active", age_ms: age, heartbeat: hb }));
      process.exit(1);
    }
  }
}

console.log(JSON.stringify({ ok: true, reason: "dispatch_allowed" }));
