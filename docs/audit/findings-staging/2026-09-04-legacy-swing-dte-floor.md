# 2026-09-04 — Legacy→Swing promotion admits dte<5 contracts (dual-admission)

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/swing/legacy-confirm-promote.ts` |
| **Severity** | P1 — same dual-admission class as 2026-08-06 horizons widening |

## Symptom

Live Swing board carried Legacy morning-confirm plays whose picked contract was dte 3–4 (CRWV, SKHY, RDDT, NVDA, AMD) while `HORIZONS.SWING.dteMin` is 5 — overlapping the 0DTE/Day-Trade board.

## Root cause

`resolveTickerChainRows` returns front expiries with no DTE filter. `buildLegacySwingArtifacts` passed the full chain to `produceHorizonPlays` while the dossier used a cosmetic `intendedDte: 14` unrelated to the committed contract.

## Fix

`filterChainRowsForSwingPromotion()` keeps only expiries in `[HORIZONS.SWING.dteMin, dteMax]` before fan-out; dossier `intendedDte` derives from the picked contract's actual DTE.

## Tests

`legacy-confirm-promote.test.ts` — filter helper + null when only sub-floor expiries + promoted contract clears dteMin.
