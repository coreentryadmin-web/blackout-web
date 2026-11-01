> **kind:** FINDING

## Thermal Discord pulse cadence misses a wall appearing/vanishing between ticks — FIXED

**Status:** Fixed, PR open (`fix/thermal-wall-null-shift`).

### Root cause

`src/lib/thermal-discord-cadence.ts`'s `wallStrikeMoved()` decides whether a ticker's
call/put GEX wall "moved" enough since the last posted snapshot to upgrade a quiet
15-minute Discord pulse (text-only embed) into a full snapshot (embed + matrix PNG):

```ts
function wallStrikeMoved(prev: number | null | undefined, next: number | null | undefined): boolean {
  if (prev == null || next == null) return false;
  return Math.abs(next - prev) >= THERMAL_WALL_MOVE_PTS;
}
```

The guard treats **either side being `null` as "nothing to compare" and reports "not
moved"** — but a wall going from a real strike to `null` (the GEX engine lost its
king-node/wall read for that tick) or from `null` to a real strike (a wall newly formed)
is exactly the kind of structural change the pulse→full upgrade exists to catch. It is
strictly more significant than a plain `>= THERMAL_WALL_MOVE_PTS` strike move, since the
member loses (or gains) an entire reference level, not just a few points of drift. The
bug silently keeps the embed in text-only pulse mode on exactly the ticks where the
picture changed the most.

This is distinct from, and does not touch, `thermalWallsShifted`'s own
`if (!prev || !Object.keys(prev).length) return false;` early-return (no prior snapshot
at all, e.g. first post after boot) — that guard is correct and untouched.

### Evidence

Added four regression tests to `src/lib/thermal-discord-embed.test.ts` (which already
imports and exercises `thermal-discord-cadence.ts`'s cadence helpers):

- `thermalWallsShifted` detects a call wall **vanishing** (775 → `null`) — failed before
  the fix (`false`, expected `true`).
- `thermalWallsShifted` detects a put wall **appearing** (`null` → 735) — failed before
  the fix.
- `thermalWallsShifted` stays quiet when a wall is absent on **both** ticks (`null` →
  `null`, genuinely no change) — passed before and after (confirms the fix doesn't
  over-flag).
- `resolveThermalDiscordMode` upgrades a 10:15 ET pulse tick to `full` when a wall
  vanishes between ticks — failed before the fix (`pulse`, expected `full`).

Confirmed RED→GREEN via `git stash` on just the source change (test file kept):
3 of the 4 new assertions failed pre-fix, all 15 (full file) + 37 (full thermal-discord
suite, incl. `thermal-discord-breach-lock-concurrency.test.ts`,
`thermal-discord-card.test.ts`, `thermal-discord-eod.test.ts`,
`thermal-discord-extras.test.ts`) pass post-fix. `tsc --noEmit` clean.

### Blast radius

`wallStrikeMoved` has exactly one call site, `thermalWallsShifted` (same file), which in
turn is called only from `resolveThermalDiscordMode` (same file) and consumed by
`src/lib/thermal-discord-run.ts` (the cron that posts the 15-minute Thermal Discord
cadence). No other caller, no other file. Fixing it at the source closes the gap for
every ticker/tick that hits this path — there is no duplicated copy of this comparison
elsewhere in the repo (confirmed via grep for `wallStrikeMoved`/`thermalWallsShifted`).

### Fix rationale

Changed `wallStrikeMoved` to treat a `null`↔non-null transition as a real shift
(`return true`), while a genuine `null`→`null` (wall absent on both ticks — a quiet/
no-gamma name) still correctly reports "not moved" since nothing actually changed. A
real numeric move still uses the existing `>= THERMAL_WALL_MOVE_PTS` threshold
unchanged. No other behavior (base cadence, `thermalWallsShifted`'s own "no prior
snapshot" early-return, `forceFull`) was touched.
