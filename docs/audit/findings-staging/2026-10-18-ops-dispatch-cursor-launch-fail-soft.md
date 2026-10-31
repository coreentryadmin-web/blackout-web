# Ops auto-fix workflow red when Cursor agent launch fails after issue create

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

After #6221, `collect-and-dispatch` successfully created GitHub issue **#6223** for the production 503 outage, then failed the job when `curl` to `https://api.cursor.com/v1/agents` returned non-zero (same class as SPX RTH `launch` job exit 22). The workflow reported **collect-and-dispatch** failure even though the durable ops artifact (the issue) was created.

## Fix

`scripts/ops-dispatch-agent.mjs`: on launch failure after issue create, comment on the issue and **exit 0** so the workflow does not go red on transient Cursor API errors.

## Verify

Manual/dry-run: simulate `curl` failure with issueNumber set → exit 0. Live: next ops-auto-fix run with action items should stay green if only agent launch fails.
