# Deploy smoke red on `/api/market/spx/desk` 502 during cold cache timeout

> **kind:** `FINDING`

### Summary
GitHub **Deploy smoke** failed on commits `0dee31c5` and `ad04f5f8f` (2026-11-09) with
`✗ /api/market/spx/desk → unexpected HTTP 502` while every other public probe was green.

### Root cause
`GET /api/market/spx/desk` called `loadSpxDesk()` which can throw `ServerCacheTimeoutError`
when the `spx-desk:<date>` cache lane loses its `maxBlockMs` race on a cold replica
(off-hours / post-deploy). The route catch block treated **all** errors as hard **502**,
unlike the sibling `GET /api/market/spx/play` route which already maps the same exception
to an honest **200** degraded response.

### Fix
On `ServerCacheTimeoutError`, return **200** with peeked desk, pulse-minimal shell, or
`{ available: false, error: "Desk warming" }` — never 502 for this known timing race.

### Evidence
- GHA logs: run `42550161810` and `42550594997`, desk probe 502, health/regime 200.
- Clerk-authed prod probe same window: desk **200** (empty shell), not 502.
- Unit: `src/app/api/market/spx/desk/route.test.ts` (timeout catch wiring).

| **Status** | FIXED — this PR |
