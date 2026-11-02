#!/usr/bin/env node
import { releaseLock } from "./lib/locks.mjs";
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

/**
 * Apply a task release to shared AGENT_STATE.json under the shared state-write lock.
 *
 * BUG FIX (round 354): this used to be a bare `readAgentState()` → mutate → `writeAgentState()`
 * with no lock at all, while `claim-task.mjs`/`record-review.mjs`/part of `pr-feedback.mjs`
 * already wrap the identical read-modify-write pattern in `withStateLock`. A lock only protects
 * writers that actually participate in it — an unlocked writer can still read a stale snapshot
 * and overwrite whatever a locked writer committed in between. Concretely: agent A releases
 * `BO-P1-XYZ` right as `sync-context.mjs` (invoked by `handoff.mjs` on every handoff, and by
 * `bootstrap.mjs`/`select-task.mjs`/`session-start.mjs` on every bootstrap) is mid-flight doing
 * several seconds of `gh`/network calls between its own `readAgentState()` and `writeAgentState()`
 * — this release's RELEASED/`released_at` stamp and its `task_released` event get silently wiped
 * the moment that sync's stale, pre-release snapshot is written back on top of it. Re-reading
 * state FRESH inside the lock (rather than reusing an earlier unlocked read) is what makes this
 * safe against a concurrent locked writer; it does not protect against a concurrent UNLOCKED
 * writer, which is exactly why `sync-context.mjs`/`handoff.mjs` needed the matching fix (same PR).
 */
export function releaseTaskInState(taskId, owner) {
  return withStateLock(() => {
    const state = readAgentState();
    if (state.tasks[taskId]) {
      state.tasks[taskId].phase = "RELEASED";
      state.tasks[taskId].released_at = new Date().toISOString();
    }
    appendEvent(state, { type: "task_released", task_id: taskId, owner });
    writeAgentState(state);
    return state;
  }, { owner: `release-${owner}` });
}

if (process.argv[1]?.endsWith("release-task.mjs")) {
  const args = parseArgs(process.argv);
  const taskId = args.id ?? args.task_id;
  const owner = args.owner ?? process.env.BLACKOUT_AGENT ?? "cursor";
  if (!taskId) process.exit(1);

  const result = releaseLock(taskId, owner);
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(2);
  }

  const stateResult = releaseTaskInState(taskId, owner);
  if (!stateResult.ok) {
    console.error(JSON.stringify(stateResult, null, 2));
    process.exit(3);
  }

  console.log(JSON.stringify({ ok: true, released: result.released }, null, 2));
}
