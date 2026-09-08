# Largo swing play-brief — copy truth fixes

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-largo-copy-2026-09-06 |
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **PR** | fix/largo-swing-brief-copy-truth |

## Symptoms

1. Hold plan labeled contract **DTE** as "Time in trade" — members saw e.g. "Time in trade: **20 DTE**" which is days-to-expiry, not days since commit.
2. Cross-desk **alignment** coaching could render `NH undefined` or `0DTE score undefined` when runtime payloads were thin — violates grounded-evidence contract.

## Fix

- `play-brief-intel.ts`: relabel to `Contract runway: **N DTE**`.
- `play-brief-narrative-coaching.ts`: only push alignment tokens when conviction/score are present and finite; require ≥2 grounded tokens before emitting Desk alignment line.

## Evidence

- `node --import tsx --experimental-test-module-mocks --test` on `play-brief-intel.test.ts` + `play-brief-narrative-coaching.test.ts` — pass.
