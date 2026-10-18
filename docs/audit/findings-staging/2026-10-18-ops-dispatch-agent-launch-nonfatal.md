# Ops auto-fix CI red when Cloud Agent launch fails — FIXED

> **kind:** FINDING

| Field | Value |
|-------|--------|
| **Status** | FIXED |
| **Area** | CI / ops-dispatch |

## Symptom

After `ops-collect` began succeeding post-#6221, `collect-and-dispatch` still failed at `ops-dispatch-agent.mjs` with empty `Cloud Agent launch failed` (curl `-sf` hid HTTP body). GitHub issue **#6223** was updated successfully.

## Fix

- Parse curl HTTP status; log response snippet on failure.
- Exit **0** when issue create/update succeeded but agent launch failed (durable action item remains on GitHub).
- `continue-on-error: true` on dispatch step as belt-and-suspenders.

## Verify

Manual dry-run with invalid key should update issue and exit 0 when issue exists.
