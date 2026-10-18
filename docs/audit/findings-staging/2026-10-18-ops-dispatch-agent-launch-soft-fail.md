# Ops dispatch fails GHA when Cursor agent launch flakes — 2026-10-18

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 — false RED on `collect-and-dispatch` during real outages |
| **Surface** | `scripts/ops-dispatch-agent.mjs` |

## Symptom

`ops-auto-fix` collected P0 items and created issue #6223, then failed:

```
[ops-dispatch] Cloud Agent launch failed:
```

## Root cause

`curl` to Cursor Agents API returned non-zero after the GitHub issue was already created.
`process.exit(1)` marked the whole `collect-and-dispatch` job failed even though the durable
action item (issue) succeeded.

## Fix

Mirror `CURSOR_API_KEY` missing behavior: exit 0 when an issue exists; comment on the issue
with launch failure details for manual dispatch.
