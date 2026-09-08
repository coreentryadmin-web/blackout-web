> **kind:** `FINDING`

## RTH open-check runs session gates on NYSE holidays — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (cleanup after #4523 — CI already green on holiday skip payload) |
| **Area** | `scripts/rth-open-check.mjs` |

### Symptom

After #4523 fixed `isSocketHealthSkipped` in the shared probe helper, `rth-open-check` still ran Postgres writer checks, data-correctness, and a duplicated inline socket loop on Labor Day 2026-09-07. The inline loop logged spurious `HTTP 200 — retrying…` after a successful holiday-skip pass (else-branch ran even when `socketProbeOk` was already true).

### Fix

- Exit GREEN immediately after `validate:deploy` when `!isTradingDayEt(ymd)` (unless `--force`).
- Delegate socket probe to shared `probeOptionsSocketWithRetries` (same path as `validate-deploy`).

### Evidence

- `node --test scripts/lib/rth-socket-probe.test.mjs` — holiday skip test GREEN.
- `node scripts/rth-open-check.mjs --force` on Labor Day: early exit without spurious retry logs.

### RTH validation

Next NYSE holiday weekday: `rth-open-check.yml` should log `market holiday — skipping RTH session checks` and exit GREEN without section 2.
