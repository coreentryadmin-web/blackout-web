#!/usr/bin/env node
/**
 * Guard against duplicate Cursor dispatches when a session is already active.
 * Exit 0 = safe to dispatch; exit 1 = skip (active session).
 */
import { readJson } from "./lib/state.mjs";
import { heartbeatPath } from "./lib/paths.mjs";

const ACTIVE_MS = Number(process.env.BLACKOUT_DISPATCH_GUARD_MS ?? 15 * 60 * 1000);
const hb = readJson(heartbeatPath("cursor"), null);
const now = Date.now();

if (hb?.last_seen) {
  const age = now - Date.parse(hb.last_seen);
  if (age < ACTIVE_MS && hb.healthy !== false) {
    console.log(JSON.stringify({ ok: false, reason: "cursor_session_active", age_ms: age, heartbeat: hb }));
    process.exit(1);
  }
}

console.log(JSON.stringify({ ok: true, reason: "dispatch_allowed" }));
