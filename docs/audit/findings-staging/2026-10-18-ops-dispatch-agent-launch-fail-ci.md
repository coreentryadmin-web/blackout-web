# Ops auto-fix: do not fail CI when Cloud Agent launch fails after issue create

> **kind:** FINDING

| **Status** | FIXED (pending merge) |
|------------|------------------------|
| **Date** | 2026-10-18 |
| **Surface** | `.github/workflows/ops-auto-fix.yml` / `scripts/ops-dispatch-agent.mjs` |

## Symptom

On `main` commit `3e5a8b87f`, CI reported `collect-and-dispatch` failed while `smoke` also failed (prod `/api/health` 503). Collect succeeded and issue **#6223** was created; `curl` to `api.cursor.com/v1/agents` failed → `ops-dispatch-agent.mjs` exited 1 → workflow red.

## Root cause

Dispatch script treated agent launch failure like issue-creation failure (`process.exit(1)`), even when `issueNumber` was set. Missing `CURSOR_API_KEY` already exited 0 when an issue existed; launch failure did not.

## Fix

On launch failure after issue create: comment on the issue with error snippet, `process.exit(0)` when `issueNumber` is set.

## Verify

- Re-run Ops auto-fix workflow after merge when action items exist; expect green `collect-and-dispatch` even if Cursor API rejects launch.
- Prod smoke remains red until `/api/health` returns 200 (separate P0 outage).
