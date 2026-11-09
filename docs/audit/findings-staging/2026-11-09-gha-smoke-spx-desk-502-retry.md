# Deploy smoke flake: SPX desk HTTP 502 right after ECS rollout

> **kind:** FINDING

## Symptom

Deploy smoke on `main` (`0dee31c5`, run `42550161810`) failed: authenticated `/api/market/spx/desk` returned **502** (`unexpected HTTP 502`) while `/api/health`, `/api/ready`, and auth gates were green. Same pattern on run `42548713697`.

## Root cause

Single-shot desk probe immediately after deploy; fresh web tasks can return route-level **502** (`Desk build failed`) while Postgres/Redis/desk cache warm. Not a Meridian regression — neighbor merge `42548174346` passed with `200 available:false`.

## Fix

Retry the desk probe via shared `fetchRetry` (5xx backoff, env-tunable) before applying `evaluateSpxDeskSmoke`.

| **Status** | FIXED |
