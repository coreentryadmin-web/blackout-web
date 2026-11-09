# Deploy smoke flakes on post-deploy SPX desk 502

> **kind:** `FINDING`

| **Status** | FIXED (PR pending) |
|---|---|

## Symptom

`Deploy smoke` failed on `main` twice overnight (runs 42548713697, 42550161810) with:

```
✗ /api/market/spx/desk → unexpected HTTP 502
```

`/api/health` and `/api/ready` were green in the same job — the route exists but `buildSpxDesk()` failed once during ECS rollout (cold cache / timeout).

## Fix

Retry the authenticated desk probe on `502/503/504` (default 4 attempts, 15s apart) before failing deploy smoke.

## Evidence

- GHA logs: desk 502 while other probes 200.
- Unit test: `shouldRetrySpxDeskProbe`.
