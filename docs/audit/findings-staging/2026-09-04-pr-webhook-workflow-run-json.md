# 2026-09-04 — PR webhook workflow_run JSON parse SyntaxError

> **kind:** FINDING

## Symptom

`BLACKOUT PR webhook` workflow failed on `workflow_run` events with:

```
SyntaxError: Unexpected token ':'
    url: https://api.github.com/repos/...
```

Run `33846591119` (2026-09-04T06:58:29Z).

## Root cause

The triage step inlined `${{ toJson(github.event.workflow_run.pull_requests) }}` directly into a `node -e` script body. GitHub's serialized pull-request stubs include bare URL strings that are valid JSON but invalid JavaScript when pasted as object literals.

## Fix

Pass `toJson` output through `PULL_REQUESTS_JSON` env and `JSON.parse()` — never splice workflow JSON into inline JS source.

## Status

FIXED in PR (workflow-only).
