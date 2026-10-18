## 2026-10-18 — [FINDING, ops] ops-auto-fix fails when Cloud Agent launch fails after issue create

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED (PR `fix/ops-dispatch-launch-fail-soft`) |
| **Severity** | P2 |
| **Surface** | `scripts/ops-dispatch-agent.mjs` |

### Symptom

After AWS fail-soft landed on `main`, `collect-and-dispatch` reached dispatch, created GitHub issue
#6223, then exited 1 because `curl` to the Cursor agents API failed — marking the whole workflow red.

### Fix

Exit 0 when an issue was created; agent launch remains best-effort with a warning.
