# sync-context wipes open_prs on GitHub API failure — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Autopilot / sync-context |
| **PR** | (this branch) |

## Symptom

When `gh pr list` or `gh run list` fails (REST/GraphQL rate limit, transient auth), `sync-context.mjs` set `state.open_prs = []` via `(openPrs ?? []).map(...)`. Bootstrap, pr-sweep, and select-task then reported **zero open PRs** — a false negative that hid three draft PRs awaiting Claude review during a pull_request wake (2026-09-05 ~15:26 UTC).

## Root cause

Null-coalescing to empty array on gh failure instead of preserving last-known-good state.

## Fix

- Preserve `open_prs` and deploy fields when respective `ghJson()` calls return `null`.
- Record `gh_degraded: true` on context_sync events for observability.

## Verification

- `npx tsx --test scripts/blackout-agent/blackout-agent.test.mjs` — regression test on preserve guard.
