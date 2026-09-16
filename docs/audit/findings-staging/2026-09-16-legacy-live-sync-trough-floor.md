## 2026-09-16 — [FINDING, FIXED] Legacy live-sync `troughOut` skipped the `entry_premium` floor `peakOut` already applies

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 |
| **Lane** | Night Hawk Legacy |
| **File** | `src/features/nighthawk/lib/legacy-live-sync.ts` |
| **PR** | (this branch) |

### Root cause

`runLegacyLiveSync` tracks a running peak and trough premium for every open Legacy position on
each pricing cycle, so the Chief Trade Alert Bot's live-management state reflects the full excursion
range since entry. The two computations were meant to be symmetric — the peak can never read below
`entry_premium`, and the trough can never read above it — but only the peak side actually enforced
that:

```ts
const peak = row.peak_premium ?? row.entry_premium;
const peakOut = Math.max(peak, mark);
const troughOut =
  row.trough_premium != null ? Math.min(row.trough_premium, mark) : mark;
```

`peak` falls back to `entry_premium` when `row.peak_premium` hasn't been seeded yet, so `peakOut`
is always `Math.max(entry_premium, mark)` at minimum — the peak can never be recorded below what
the position actually entered at. `troughOut`'s ternary had no equivalent fallback: when
`row.trough_premium` was `null`, it fell straight through to the raw `mark` with no floor at all,
instead of `Math.min(entry_premium, mark)`.

### Evidence

A row can reach the main per-row loop with `peak_premium`/`trough_premium` still `null` whenever its
`discord_live_state` predates a peak/trough seed — the `LegacyLiveSyncRow` type declares both as
`number | null`, and `ensureLegacyDiscordBtos`'s own BTO-backfill path (`runLegacyLiveSync` lines
153-164, "Post missing BTO embeds for open rows … edition published before alerts were live") writes
a seeded `peakPremium`/`troughPremium` to the DB but never refreshes the in-memory `rows` array it
was called with, so a play whose BTO gets backfilled in the *same* invocation still carries `null`
peak/trough through the rest of that cycle's loop.

RED→GREEN proven in `legacy-live-sync.test.ts`: a row entering the loop with
`peak_premium: null, trough_premium: null, entry_premium: 4`, a mark of `5` (a favorable first
tick, above entry) produced `peakPremium: 5` (correct, `max(4, 5)`) but `troughPremium: 5` (wrong —
should floor at `entry_premium`, `min(4, 5) = 4`, the true lowest premium ever actually observed).
Reverting the fix alone reproduces the failure (`5 !== 4`); restoring it passes.

### Blast radius

Single function (`runLegacyLiveSync`'s main per-row loop) — `troughOut` computed here feeds
`deps.updateLiveState`'s `troughPremium`, persisted to `discord_live_state.trough_premium` and
surfaced through the Legacy live-sync reporting path. Not read by `deriveLegacyPlanAction` or
`deriveScaleOutAction` (verified — neither references trough), so this never affected an actual
CLOSE/TRIM/HOLD trade-management decision; it is a drawdown-excursion bookkeeping/reporting value.

### Fix rationale

Mirror the exact fallback pattern already used for `peak` — introduce a `trough` variable with the
same `?? row.entry_premium` fallback, then `Math.min(trough, mark)`. This is the smallest possible
fix: it makes the two computations textually and behaviorally symmetric, with no change to any
branch outside the null-trough-premium case.

### Regression test

`src/features/nighthawk/lib/legacy-live-sync.test.ts` — new test constructs a row with
`peak_premium`/`trough_premium` both `null` and a favorable first mark, then asserts both
`peakPremium` and `troughPremium` correctly floor at `entry_premium`. RED→GREEN proven via
git-stash: 5 pass / 1 fail with the fix reverted; 6/6 pass restored.
