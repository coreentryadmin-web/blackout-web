# VIX SSE pulse change% used session-open anchor — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|
| **Area** | SPX desk / SSE pulse overlay |
| **Pri** | P1 |

## Symptom

VIX day-change% on the SSE-overlaid SPX pulse path was transported raw from `polygon-socket` `indexStore`, while SPX was derived from `prior_close` since the 2026-08-07 P0. A ws-bar-anchored VIX `change_pct` could disagree with the true prior-close day change — same defect class as SPX, second door via `usePulseStream`.

## Root cause

`overlayFromStream` in `usePulseStream.ts` derived `spx_change_pct` via `pulseChangePctFromPriorClose` but left `vix_change_pct` transported because `SpxDeskPulse` carried no VIX prior close.

## Fix

- Add `vix_prior_close` to `SpxDeskPayload` / `SpxDeskPulse` (from `fetchIndexSnapshots` `prev_close` for `I:VIX`).
- Derive `vix_change_pct` with `pulseChangePctFromPriorClose` in `buildSpxDeskPulse`, full desk build, minimal pulse, and SSE overlay.
- Carry `vix_prior_close` through `mergePulseIntoDesk` and `roundPulseNumerics`.

## Evidence

`npx tsx --test src/hooks/usePulseStream.test.ts` — VIX derives from `vix_prior_close`, falls back when absent.

## Market-open check

RTH: compare SPX desk header VIX % vs Polygon index snapshot `session.change_percent` for `I:VIX` while SSE connected.
