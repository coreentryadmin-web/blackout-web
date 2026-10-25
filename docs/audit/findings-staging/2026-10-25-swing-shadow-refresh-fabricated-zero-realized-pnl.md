> **kind:** FINDING

## Night Hawk Swings — `shadowRealizedPnlPct` fabricated 0% realized P&L on invalid entry premium, permanently closing a shadow row with a fake calibration outcome — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `src/lib/swing/shadow-refresh.ts` (`shadowRealizedPnlPct`, `runSwingShadowRefresh`) |
| **Severity** | P2 (live-wired calibration-feed corruption, narrow trigger) |

### Root cause

`shadowRealizedPnlPct`'s own doc comment says it uses "the same sign convention as roll-plan
`gradeParentFromMark`" — but `gradeParentFromMark` (`roll-plan.ts`) returns `null` on an invalid
entry premium ("a roll must never freeze a fabricated grade — it DEFERS instead"), while
`shadowRealizedPnlPct` returned a literal `0` (a fabricated flat/"breakeven" close) for the same
invalid-input shape (`!Number.isFinite(entryPremium) || entryPremium <= 0`).

This module is wired into production: `runSwingShadowRefresh` is called from the
`swing-active-refresh` cron (`src/app/api/cron/swing-active-refresh/route.ts`) and its
`closeAndGrade` callback is bound to `closeSwingShadowPosition` (`db.ts`), which marks the row
`CLOSED` and writes `realized_pnl_pct` permanently. The caller's own guard before calling
`shadowRealizedPnlPct` only checked `entry == null` — not `Number.isFinite(entry)` or `entry > 0` —
so a shadow row with a corrupted `entry_premium` (0, negative, or NaN) would fall through to a
fabricated `0%` close and get marked `CLOSED` forever, with no re-evaluation path. Per this file's
own header, shadow rows exist specifically to "feed calibration evidence" for the PR-16 graduation
ladder — a fabricated 0% outcome pollutes exactly that feed, permanently, since `CLOSED` is terminal.

### Evidence

Live repro:

```js
shadowRealizedPnlPct(0, 12.5)   // entry_premium corrupted to 0
shadowRealizedPnlPct(-5, 12.5)  // entry_premium corrupted to negative
shadowRealizedPnlPct(NaN, 12.5) // entry_premium corrupted to NaN
```

Pre-fix: all three return `0` (a fake breakeven close).
Post-fix: all three return `null`.

And at the `runSwingShadowRefresh` level: a row with `entry_premium: 0` whose structural stop would
otherwise fire pre-fix called `closeAndGrade` with `realized_pnl_pct: 0` (permanently closing the
row on fabricated data); post-fix it is skipped (`skipped += 1`), leaving the row `OPEN` for
re-evaluation next pass — the honest "defer, never fabricate" posture `roll-plan.ts` already uses
for the identical input shape.

### Blast radius

Single call site inside `runSwingShadowRefresh` (confirmed via `git grep -rln
"shadowRealizedPnlPct" src/`), but that call site is live production code on every
`swing-active-refresh` cron pass. Reachability requires a corrupted/invalid `entry_premium` column
on a real shadow row — not the common case, but shadow rows are written at commit-gate-block time
(`commit.ts`'s zero-capital SHADOW path) and this file's own guard shape (checking
`Number.isFinite`/`> 0` defensively) already anticipates that a typed-as-required DB value can
still arrive malformed, the same "typed as required, defensively re-checked anyway" pattern every
sibling null-honesty fix in this codebase guards against.

### Fix rationale

Two changes, mirroring the exact pattern `roll-plan.ts`'s `gradeParentFromMark` already
establishes: (1) `shadowRealizedPnlPct` now returns `number | null`, `null` on the identical
invalid-input guard it already had (never a fabricated `0`); (2) `runSwingShadowRefresh` checks the
result for `null` immediately after computing it and skips (never calls `closeAndGrade`) exactly
like its existing `entry == null`/`exitMark == null` guards two lines above — a corrupted row stays
`OPEN` and gets another chance on the next cron pass instead of being permanently mis-graded.

### Tests

Added a direct case to `shadow-refresh.test.ts` (`shadowRealizedPnlPct` returns `null` for
entry 0/negative/NaN and for a non-finite exit mark) and an integration case (`runSwingShadowRefresh`
never calls `closeAndGrade` for a row whose structural stop would otherwise fire but whose
`entry_premium` is `0`). RED→GREEN confirmed: reverting only the source fix (keeping the new tests)
fails 2/10 exactly as expected; reapplying passes 10/10.

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/shadow-refresh.test.ts` — 10/10 pass
- `npx tsc --noEmit` — clean
- Full `npm test` (Node 20) run alongside this PR
