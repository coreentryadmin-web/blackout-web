# Grid/SPX RTH agent launch painted main red on Cursor API errors — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-grid-spx-agent-launch-nonfatal |
| **Priority** | P3 |
| **Area** | GitHub Actions / Cloud Agent dispatch |
| **Status** | FIXED |

## Symptom

Scheduled **Grid RTH all-day agent** / **SPX RTH all-day agent** jobs failed with `launch` check red on unrelated `main` commits (e.g. `441ed1f18`, `227996a13`). Logs show `curl -sf` to `https://api.cursor.com/v1/agents` exiting **22** (HTTP error) — no application code change involved.

## Root cause

`grid-rth-all-day-agent.yml` and `spx-rth-all-day-agent.yml` used `set -euo pipefail` with bare `curl -sf` assignment. Transient Cursor API / rate-limit failures fail the workflow and attach a failing **launch** check to the branch HEAD, even though product CI (`verify`, `smoke`) is green.

Sibling workflows (`blackout-hourly-checklist.yml`, `blackout-autopilot-dispatch.yml`, `blackout-pr-webhook.yml`) already treat launch failure as `::warning::` + `exit 0`.

## Fix

Match the hourly/autopilot pattern: on failed agent POST, emit `::warning::` and exit 0 so ops can see the miss without marking `main` failed.

## Blast radius

Grid/SPX scheduled agent dispatch only. Successful launches unchanged.

## Evidence

`npx tsx --test src/github-workflows-yaml-parse.test.ts` — YAML still valid.
