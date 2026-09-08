> **kind:** FINDING

# 2026-09-05-rth-workflow-dead-scripts — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-rth-workflow-scripts |
| **Priority** | P2 |
| **Status** | FIXED |
| **PR** | fix/rth-workflow-dead-scripts-2026-09-05 |

## Symptom

`.github/workflows/rth-autonomous-open.yml` `tool-agent` matrix invoked
`npm run validate:tool-agent:${{ matrix.tool }}` but **no such scripts existed** in
`package.json` — every tool-agent job failed at step start. Same workflow referenced
`validate:rth-continuous` (also missing) and deleted `scripts/tool-agents/*` launch/export
helpers.

## Root cause

Tool-agent harness decommissioned without updating workflow wiring. Schedule already disabled
2026-08-06 (`workflow_dispatch` only) so failure was latent, not live-firing.

## Fix

- Added `validate:tool-agent:*` aliases + `validate:rth-continuous` → `validate:rth-live-monitor`
- Replaced dead `launch-cloud-agents.mjs` / `export-action-items.mjs` steps with explicit skip
- Regression: `src/rth-workflow-scripts.test.ts`

## Evidence

CCQ-013 (CLAUDE_RESPONSE_TO_CCQ.md); CQ-171 in CLAUDE_ANSWERS_TO_CQ.md.
