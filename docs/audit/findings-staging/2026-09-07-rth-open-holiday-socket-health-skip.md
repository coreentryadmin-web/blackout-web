# RTH open-check false RED on NYSE holidays — socket-health skip shape

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `scripts/lib/rth-socket-probe.mjs`, `scripts/rth-open-check.mjs` |
| **Pri** | P1 |

## Symptom

Scheduled `rth-open-check.yml` (`open-check` job) failed on **2026-09-07** (Labor Day) with:

`options-socket (socket-health): probe HTTP 200`

## Root cause

`GET /api/cron/socket-health` correctly returns `{ ok: true, skipped: true, reason: "non-trading day (2026-09-07)" }` on NYSE holidays (no WS boot). The RTH harness expected `body.websockets.options`; absent that block it retried three times and failed on HTTP 200.

## Fix

- `isSocketHealthSkipped()` + early pass in `probeOptionsSocketWithRetries()`
- Refactored `rth-open-check.mjs` to use the shared probe helper (same path as `validate-deploy.mjs`)

## Verify

- `npx tsx --test scripts/lib/rth-socket-probe.test.mjs`
- `node scripts/rth-open-check.mjs --force` on holiday → GREEN (socket skip logged)
