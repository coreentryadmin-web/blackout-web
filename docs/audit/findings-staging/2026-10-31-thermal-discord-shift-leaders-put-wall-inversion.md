# 2026-10-31 Thermal Discord shift-leaders line mislabels put-wall build/melt (and inverts the %)

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 data-correctness (member-facing Discord posts) |

## Root cause

`buildThermalShiftLeadersLine` (`src/lib/thermal-discord-extras.ts`) is the Thermal Discord
shift-leader sub-line — wired live into both the intraday "full" post and the ~4:05 PM ET
session-close recap via `buildThermalDiscordEmbedWithExtras`/`buildThermalEodRecapEmbed`
(`thermal-discord-run.ts` sets `includeShiftLeaders = mode === "full"`).

It bucketed leaders into "build"/"melt" by the **raw signed delta** (`l.delta > 0` → build,
`l.delta < 0` → melt) and displayed `leader.pct`, which is `shiftPercentForStrike(current, delta)`
— `delta / |baseline| * 100`, also keyed to the raw delta's sign.

That convention is correct only for a call-side (positive-GEX) strike. For a **put-side** strike
it inverts: a put wall that is *strengthening* (its net GEX going more negative, e.g.
`-700,000 → -900,000`, delta `-200,000`) has `delta < 0`, so the old code called it "melt" at
`-29%` — when the wall's magnitude actually *grew* 700k→900k, i.e. it **built** by `+29%`.
Symmetrically, a decaying put wall (`-900,000 → -700,000`, delta `+200,000`) was labeled "build
+22%" when it actually melted by `-22%`.

This exact inversion was already identified and fixed for the live UI: `wallStrengthShift`
(`src/features/thermal/lib/gex-heatmap/shift-math.ts`) computes `built`/`pct` off the magnitude
delta (`|current| - |baseline|`) specifically to avoid it, and both `GexMatrixShiftBadge.tsx` and
`GexShiftLeadersStrip.tsx` already call `wallStrengthShift(leader.currentValue, leader.delta)`
directly rather than trusting `leader.delta`'s sign or `leader.pct`. `buildThermalShiftLeadersLine`
was the one caller that still used the old raw-delta convention — it predates `wallStrengthShift`
and was never migrated when the UI badges were fixed.

## Evidence

Put wall, strike 95: `currentValue = -900_000`, `delta = -200_000` (baseline `-700_000`).

- Old code: `l.delta < 0` → bucket "melt", displayed `leader.pct = -200000/700000*100 ≈ -28.6%`
  → Discord line: `_melt 95 (-29%)_`.
- `wallStrengthShift(-900000, -200000)` → `{ pct: 28.57, built: true }` — the wall actually
  **built** by `+29%`.

RED→GREEN proven via `git stash` on `src/lib/thermal-discord-extras.ts` alone (test file kept):
pre-fix, `buildThermalShiftLeadersLine` returns `"_melt 95 (-29%)_"` for the strengthening-put-wall
fixture and `"_build +95 (+22%)_"` for the melting-put-wall fixture — both inverted; post-fix it
returns `"_build +95 (+29%)_"` and `"_melt 95 (-22%)_"` respectively.

## Blast radius

Both live call sites of `buildThermalShiftLeadersLine` are affected whenever a put-side strike is
among the top-N shift leaders: the intraday "full" Thermal Discord post and the session-close
recap post (`buildThermalEodRecapEmbed`). Call-side strikes were never affected (the raw-delta and
magnitude conventions agree in sign there), which is why no symptom was ever observed on the
call-wall leaders — only put-wall leaders carried the backwards label + sign, which is the harder
half to spot by eye in a Discord feed since "the % looked plausible, just backwards."

## Fix

`buildThermalShiftLeadersLine` now calls `wallStrengthShift(l.currentValue, l.delta)` per leader
(the same helper the UI badges already use) and buckets/labels off `strength.built`/`strength.pct`
instead of the raw `l.delta`/`l.pct`. No change to `pickGexShiftLeaders`, `GexShiftLeader.pct`, or
either UI consumer — they were already correct; this fixes the one remaining caller that wasn't.

## Verify

- `npx tsx --experimental-test-module-mocks --test src/lib/thermal-discord-extras.test.ts` (new,
  3 cases: strengthening put wall, melting put wall, call wall unaffected)
- `npx tsx --experimental-test-module-mocks --test src/lib/thermal-discord-breach-state.test.ts src/lib/thermal-discord-breach-lock-concurrency.test.ts src/lib/gex-shift-leaders.test.ts src/features/thermal/lib/gex-heatmap/shift-math.test.ts` — all green, no regressions
- `npx tsc --noEmit` clean
