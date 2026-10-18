# ops-auto-fix failed when Cursor agent launch failed after issue update — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-ops-dispatch-launch-softfail |
| **Priority** | P2 |
| **Area** | GitHub Actions / ops-auto-fix |
| **Status** | FIXED |

## Symptom

On `main@3e5a8b87f`, **collect-and-dispatch** failed at `ops-dispatch-agent.mjs` after successfully updating GitHub issue #6223: `[ops-dispatch] Cloud Agent launch failed` (curl exit from Cursor API).

## Root cause

`ops-dispatch-agent.mjs` called `process.exit(1)` when agent POST failed, even though the ops issue was already created/updated. That painted `main` red on top of the real **smoke** failure (prod 503).

## Fix

When an issue exists, log the launch failure, comment on the issue, and **exit 0** so the workflow completes; only exit 1 when no issue could be filed.

## Blast radius

ops-dispatch / ops-auto-fix dispatch step only.

## Evidence

Manual trace of GHA run 39152887738 — collect + issue update succeeded; only curl agent launch failed.
