# ops-auto-fix red when Cursor agent launch failed after issue create — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-ops-dispatch-launch-nonfatal |
| **Priority** | P2 |
| **Area** | Ops auto-fix dispatch |
| **Status** | FIXED |

## Symptom

`collect-and-dispatch` failed at `ops-dispatch-agent.mjs` after successfully creating
issue #6223 — `Cloud Agent launch failed` with exit 1 (run 39152546071).

## Root cause

`curl` to Cursor agents API failed, but the GitHub issue (durable action item) already
existed. Workflow treated launch failure as fatal.

## Fix

Exit 0 when `issueNumber` is set and agent launch fails (same posture as missing
`CURSOR_API_KEY`).
