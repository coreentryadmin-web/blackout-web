# 2026-09-05 — Options async mark + lit/dark ratio future-timestamp guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `options-socket.ts` async mark read, `uw-lit-dark-ratio.ts` |
| **Status** | FIXED |

## Symptom

`getLiveOptionMark()` (async, Redis fallback path) and `computeLitDarkRatio()` used raw `Date.now() - ts <= maxAgeMs` age math. A clock-skewed future stamp produced a negative age that passed the check, so stale/untrustworthy data read as **live** — while the sync mark path (`getLiveOptionMarkSync`) already used shared `isWsUpdatedAtFresh`.

## Root cause

Async mark read was not migrated when sync path got the future-timestamp guard. Lit/dark ratio was never migrated.

## Fix

- `getLiveOptionMark`: gate local + Redis hits through `isWsUpdatedAtFresh`.
- `computeLitDarkRatio`: gate lit + dark `updatedAt` through `isWsUpdatedAtFresh`.

## Evidence

- `options-socket-gate.test.ts` — async Redis fallback source scan.
- `uw-lit-dark-ratio-freshness.test.ts` — lit/dark source scan.

## RTH validation

- 0DTE live marks via async `getLiveOptionMark` should fall back to snapshot when quote stamp is skewed future (no phantom live mark).
- Vector/HELIX lit-vs-dark ratio tile should show absent/stale when UW store timestamps are skewed future, not a fabricated ratio.
