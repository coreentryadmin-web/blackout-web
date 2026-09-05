> **kind:** FINDING

# Future timestamps rendered false-fresh on Night Hawk / HELIX / Largo — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Night Hawk command deck, HELIX mobile tape, Largo history |
| **PR** | (pending) |

## Symptom

Clock-skewed or future-dated event timestamps clamped to age `0` / `"just now"` / `"0s"`, causing Night Hawk Legacy play cards to pulse `JUST FIRED`, HELIX compact tape to show `0s`, and Largo history to read `"just now"` for events that had not occurred yet.

## Root cause

`eventAgeMs`, `formatRelativeAge`, `formatCompactAge`, `timeAgo`, and `relativeTime` used `delta < 0 → clamp to zero/just now` instead of the shared `ageSecFromIso` future guard (`WS_TIMESTAMP_FUTURE_TOLERANCE_MS` = 5s) already used across Vector/WS freshness paths.

## Fix

Route all three surfaces through `ageSecFromIso` / `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`:

- `src/features/nighthawk/command-deck/play-card-lifecycle.ts`
- `src/features/helix/lib/helix-flow-format.ts`
- `src/features/largo/answer/answer-format.ts` (+ `LargoTerminalToolbar` history label)

Far-future timestamps now return `null` / `"—"` instead of false-fresh labels.

## Evidence

- `npx tsx --test src/features/nighthawk/command-deck/play-card-lifecycle.test.ts`
- `npx tsx --test src/features/helix/lib/helix-flow-format.test.ts`
- `npx tsx --test src/features/largo/answer/answer-format.test.ts`
