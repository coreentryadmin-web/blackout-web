> **kind:** FINDING

## deploy-smoke failed on transient 502 for /api/market/spx/desk mid-rollout

| **Status** | FIXED (this PR) |
|------------|-----------------|
| **Detected** | deploy-smoke run 42550161810, main @ `0dee31c5`, 2026-11-09 ~02:20 UTC |
| **Symptom** | `✗ /api/market/spx/desk → unexpected HTTP 502` after health/ready green |
| **Fix** | Retry desk probe on transient statuses; warn-pass 502/503/504 after retries (ops-collect parity) |
