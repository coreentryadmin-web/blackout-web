# SPX desk route 502 on ServerCacheTimeoutError

> **kind:** FINDING

| **Status** | FIXED |
|---|---|
| **Surface** | `GET /api/market/spx/desk`, deploy-smoke |
| **Symptom** | Post-merge `deploy-smoke` failed with `✗ /api/market/spx/desk → unexpected HTTP 502` (run 42550161810, commit `0dee31c5c`) |
| **Root cause** | `loadSpxDesk()` threw `ServerCacheTimeoutError` on cold ECS replica; route caught all errors as 502. Sibling `/api/market/spx/play` already degrades to 200 on the same error. |
| **Fix** | On `ServerCacheTimeoutError`, return stale peek if grounded, else `deskShellFromPulse(buildSpxDeskPulseMinimal())` as 200. |
| **Verify** | Post-deploy `validate:gha-smoke`; cold replica desk should not 502. |
