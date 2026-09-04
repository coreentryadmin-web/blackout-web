# PR feedback gh checks fetch fails on invalid JSON field

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **PR** | (pending) |
| **Area** | autopilot / pr-feedback |

## Root cause

#3494 added `checkConclusion()` to normalize gh CLI `state`/`bucket`, but `handlePrWebhook` still requested `conclusion` in `gh pr checks --json`. Current `gh` CLI rejects that field (`Unknown JSON field: "conclusion"`), so `ghJson` returned `null` → empty checks → triage still reported `verify: missing`.

## Evidence

```bash
gh pr checks 3494 --json name,state,conclusion,bucket
# → "Unknown JSON field: conclusion" (exit 1)
```

Same bug in `pr-dispatch-check.mjs`.

## Fix

Remove `conclusion` from `--json` field lists; normalization via `checkConclusion()` handles state/bucket.

## Tests

Existing `pr-feedback.test.mjs` — 16/16 pass (15 in CI where gh fallback is skipped).
