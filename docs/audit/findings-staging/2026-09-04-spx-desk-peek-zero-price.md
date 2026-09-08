# 2026-09-04 — SPX desk peek serves price:0 bootstrap shell

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | `/api/market/spx/desk` cache peek |
| **Status** | FIXED |

## Symptom

`validate:platform-integrity` intermittently FAILs `spx-desk-spot — SPX 0` while `thermal-spx-matrix` passes with spot≈7718 on the same run. Members can flash SPX 0 on cold cache.

## Root cause

`GET /api/market/spx/desk` returned any `peekSpxDesk()` hit immediately. Bootstrap fast-lane / pulse-minimal fallbacks cache `deskShellFromPulse` with `price: 0` before `buildSpxDesk()` completes.

## Fix

Only take the peek fast-path when `instant.price > 0`; otherwise fall through to `loadSpxDesk()`.

## Evidence

- Source scan: `src/app/api/market/spx/desk/route.test.ts`
- Repro: first `validate:platform-integrity` run FAIL, immediate re-run PASS (same session)

## RTH validation

- Cold-load `/terminal` (SPX desk) after deploy — header spot must match Thermal matrix spot within 1%, never 0 during an open/extended session with live index data.
