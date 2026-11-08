# Deploy smoke false-red on weekend SPX desk 200 + price 0

> **kind:** `FINDING`

| **Status** | FIXED (PR pending) |
|---|---|

## Symptom

`Deploy smoke` on `main` failed repeatedly (e.g. run 42502809714, commit `7ee8e8e`) with:

```
✗ /api/market/spx/desk → 200
```

Cron auth succeeded (`200`) but `body.price` was not positive — normal off-hours when the desk returns an honest shell.

## Root cause

`scripts/gha-http-smoke.mjs` treated any authenticated `200` without `price > 0` as a hard failure, after the earlier `401/403` secret-drift carve-out. Weekends and pre-/post-market pushes therefore red the entire deploy pipeline even though health/ready and route wiring were fine.

## Fix

- Extract `evaluateSpxDeskSmoke()` in `scripts/lib/gha-desk-smoke-eval.mjs`.
- Still **fail** on RTH weekdays when cron auth returns `200` with no positive spot.
- **Warn-and-pass** off-hours `200` with `price === 0` or `available: false`, and keep warn on `401/403` drift.

## Evidence

- Unit tests: `scripts/lib/gha-desk-smoke-eval.test.ts` (Saturday vs Wednesday RTH).
- Local: `npm run validate:gha-smoke` exits 0 with cron drift warn.
