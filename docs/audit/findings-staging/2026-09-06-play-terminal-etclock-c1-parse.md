# PlayTerminal etClock missed Largo C1 asOf stamps — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Night Hawk / Ask Largo |
| **PR** | (pending) |

## Symptom

PR #4152 fixed `SwingLargoInsightsPanel` by teaching `@/lib/et-clock` to parse Largo C1
`YYYY-MM-DD HH:mm ET` stamps. `PlayTerminal.tsx` still exported a duplicate `etClock` that only
called `Date.parse()` — any C1 stamp routed through the deck why-now ribbon or CommandDeck row
chips would render `— ET` instead of a wall clock.

## Root cause

Eleven surfaces were migrated to `@/lib/et-clock` in an earlier sweep, but Night Hawk's deck kept a
local copy for 24-hour `HH:MM` formatting. When play-brief began stamping C1 `asOf` on #4142, only
the Largo panel import was updated (#4152); the deck duplicate remained.

## Fix

Delegate `PlayTerminal.etClock` to `@/lib/et-clock` with `{ hour12: false, pad: true }` so ISO and
C1 stamps share `parseEtStamp()`. Regression tests lock parity for ISO why-now (`10:42`) and C1
(`16:00`).

## Verify

- `npx tsx --test src/features/nighthawk/command-deck/play-terminal-etclock.test.ts`
- `npx tsx --test src/features/nighthawk/command-deck/PlayTerminal.ssr.test.ts` (why-now `10:42 ET`)
