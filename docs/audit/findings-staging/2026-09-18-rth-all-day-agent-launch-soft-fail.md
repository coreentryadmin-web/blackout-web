# RTH all-day agent workflows red on Cursor API HTTP errors — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED (pending merge) |
| **Priority** | P2 |
| **Area** | ops / GitHub Actions |
| **Symptom** | `launch` job failed with curl exit 22 on `POST https://api.cursor.com/v1/agents` (SPX + Grid scheduled verify passes). |
| **Root cause** | `spx-rth-all-day-agent.yml` and `grid-rth-all-day-agent.yml` used `set -euo pipefail` + bare `curl -sf` with no fallback; transient Cursor API 4xx/5xx (quota/rate limit) failed the workflow even though verify is best-effort dispatch. |
| **Fix** | Match `blackout-autopilot-dispatch.yml` / `blackout-hourly-checklist.yml`: `::warning::` + `exit 0` when agent launch curl fails. |
| **Evidence** | GH run `35376265724` (SPX), `35376180256` (Grid) — exit code 22 at agent POST step. |
