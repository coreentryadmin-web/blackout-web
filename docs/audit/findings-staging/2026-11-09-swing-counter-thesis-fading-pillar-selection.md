# 2026-11-09 — [FINDING, P2 Night Hawk Swings / Ask Largo] `counterThesisLine()` cited the wrong "fading pillar" — array-order `.find()` instead of the pillar with the worst real `deltaPts` — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — this PR |
| **Found by** | Adversarially-verified live repro against production (`GET /api/market/swing/play-brief`), under the standing "Ask Largo x Night Hawk Swings" ownership mandate (task #96) |
| **Scope** | `src/lib/swing/play-brief-narrative.ts` (`counterThesisLine`) |

## Summary

`counterThesisLine()` in `src/lib/swing/play-brief-narrative.ts` builds the member-facing
"Counter-thesis" bullet of Ask Largo's swing play-brief. One of its evidence sources is a
"fading pillar" drawn from the position's own Thesis-health breakdown
(`play.thesisHealth.pillars`) — but it picked that pillar with a bare `Array.prototype.find()`
over the pillars array, with **no reference to `deltaPts` at all**. `.find()` returns the FIRST
match in fixed declaration order (persistence, entry_geometry, flow_corroboration, regime,
theta_budget — see `computeSwingThesisHealth`'s `defs` array, `thesis-health.ts`) whose
`status` is `"lost"`/`"faded"` — regardless of which pillar actually moved the most.

Live reproduction (confirmed against production, re-verified as still real on current `main`
before this fix, not a duplicate of any in-flight work): `GET /api/market/swing/play-brief?
playId=SWING:PLTR&ticker=PLTR&status=COMMIT` (positionId 74, SHORT, manageAction
`TAKE_PARTIAL`) rendered the Thesis-health pillar breakdown showing

```
Persistence — scale-out (Delta +0.0 pts)
Theta budget — DTE 4 migrate (Delta -3.0 pts)
```

yet the SAME response's Counter-thesis bullet said **"fading pillar Persistence"** instead of
**Theta budget** — directly contradicting the brief's own displayed numbers two bullets above.
Reproduced identically on GOOG (positionId 73).

## Root cause

1. `degradeFromManage()` (`src/lib/swing/thesis-health.ts` ~line 403-419) unconditionally does
   `target.currentScore = Math.min(target.currentScore, 0.55)` and force-sets the Persistence
   pillar's `status = "faded"` whenever the live manage-engine action is
   `TAKE_PARTIAL`/`EXIT_RUNNER` — fired regardless of whether Persistence's score was already at
   or below 0.55.
2. When the position's setup has degraded to `FORMING` (price retraced past the entry trigger),
   `setupPersistenceScore()` already returns `{commit: 0.55, current: 0.55}` — so the clamp above
   is a mathematical no-op, and Persistence's own `deltaPts`
   (`weight * (currentScore - commitScore) * 100` — see `thesis-health.ts` ~line 507) correctly
   computes to `0.28 * (0.55 - 0.55) * 100 = 0`.
3. But Persistence (first in the `defs` array's declaration order) still won the `.find()` over a
   genuinely-decayed Theta budget pillar (real `deltaPts: 0.15 * (0.55 - 0.75) * 100 = -3`, actual
   calendar/DTE decay via `thetaBudgetScore`'s "migrate" branch) — because `.find()` doesn't
   compare magnitudes, it just takes array position.
4. The sibling renderer `thesisPillarCoaching()` (`src/lib/swing/play-brief-narrative-coaching.ts`
   ~line 90-92) already does this correctly — it sorts lost/faded candidates by `deltaPts`
   ascending and picks the worst actual mover:
   `.filter(...).sort((a,b) => (a.deltaPts??0)-(b.deltaPts??0))[0]`. This proves the correct
   selection logic already existed elsewhere in the same file family; `counterThesisLine` just
   never got it — the two functions render a DIFFERENT bullet ("Pillar fade" vs "Counter-thesis")
   off the same `pillars` array, and only one of them picked by magnitude.

## Blast radius — other call sites checked

Searched every `.find()`/`.filter()` touching `pillars`/`status === "lost"`/`"faded"` in
`play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`, `play-brief.ts`, and
`thesis-health.ts`:

- `thesisPillarCoaching` (play-brief-narrative-coaching.ts) — already correct (the model for this
  fix), untouched.
- `thesisHealthSection` (play-brief.ts, both the calibrated and the "pillar breakdown not shown"
  uncalibrated branches) — renders **every** pillar in the breakdown (`h.pillars.map(...)`), never
  selects a single "worst" one, so there is no array-order-vs-magnitude gap to have.
- `computeSwingThesisHealth`'s own `moves` loop (thesis-health.ts ~line 520-525) — pushes a move
  line for **every** lost/faded pillar it iterates, not a single `.find()`-style selection; same
  reasoning, not affected.
- `degradeFromManage`, the `regimePillar`/`target` lookups in thesis-health.ts (lines 111, 190,
  408) — all `.find()` by `id`/`label` identity (locating ONE specific named pillar to mutate or
  read), not a "pick the worst of several candidates" selection — a different operation entirely,
  not the same bug shape.

No second latent instance of the identical mistake was found — `counterThesisLine` was the only
caller selecting among multiple same-status candidates without consulting `deltaPts`.

## Fix

```ts
const faded = thesisHealthUncalibrated(play.thesisHealth)
  ? undefined
  : play.thesisHealth?.pillars
      ?.filter((p) => p.status === "lost" || p.status === "faded")
      .sort((a, b) => (a.deltaPts ?? 0) - (b.deltaPts ?? 0))[0];
```

Mirrors `thesisPillarCoaching`'s already-correct selection: among lost/faded candidates, sort by
`deltaPts` ascending and take the worst (most negative) real mover. `Array.prototype.sort` is
stable (ECMA2019+), so when every candidate ties at the same delta — including the common
all-zero case, where nothing genuinely moved and there is nothing to rank by — the original
declaration-order winner is preserved, i.e. the exact same observable output as before in that
edge case, rather than fabricating a rank among equals or reporting no fading pillar at all. This
was a deliberate choice (checked against `thesisPillarCoaching`'s own behavior, which relies on
the same stability property) rather than an accident of `Array.prototype.sort`'s spec.

## Fix rationale — what was deliberately left unchanged

- **`thesisHealthUncalibrated()` gating** — already correct and unrelated to this bug (the live
  repro positions are fully calibrated; this fix does not touch the uncalibrated-guard branch at
  all, it only changes which pillar is picked once that guard has already let a read through).
- **The 2026-09-21 uncalibrated-guard fix and the 2026-10-21 weight-label fix** (both documented in
  the surrounding code comments) — neither touches pillar *selection*; both are orthogonal and
  left untouched.
- **`thesisPillarCoaching()` itself** — the model for this fix, not something to change.
- **Exact mirror vs. independent judgment**: considered requiring the winning delta be strictly
  nonzero (falling back to array order only when every candidate ties at 0), which is functionally
  IDENTICAL to the stable-sort behavior actually shipped — `Array.prototype.sort`'s stability
  already produces that exact fallback for free, so no extra branch was needed. `thesisPillarCoaching`
  has the identical "what if everything ties at 0" edge case and relies on the same stability
  property rather than an explicit nonzero check, so the two functions now share one selection
  mechanism rather than two independently-written ones that could drift apart.

## Evidence (RED → GREEN)

RED (pre-fix, via a plain file-copy backup/restore of `play-brief-narrative.ts` — not
`git stash`, per this repo's shared-stash-risk note): the new regression test
(`src/lib/swing/play-brief-narrative.test.ts`, "cites the pillar with the worst real deltaPts
(Theta budget), not the first array-order match (Persistence) with a zero delta") fails exactly
on the live bug shape:

```
error: expected Theta budget to be cited as the fading pillar, got:
**Counter-thesis (bull case)** — a single, uncorroborated signal — fading pillar **Persistence**.
If this wins, honor invalidation — don't hope.
```

GREEN (post-fix, fix restored):
- `src/lib/swing/play-brief-narrative.test.ts`: 174/174 pass (including the new test and every
  pre-existing `counterThesisLine`/fading-pillar test, confirmed un-regressed — in particular the
  existing "calibrated thesisHealth with a genuinely faded pillar still steelmans it" test, which
  uses a `TRIGGERED` setupState where Persistence's own `deltaPts` is genuinely `-10` (a real
  mover, not a zero-delta no-op) and correctly still wins under the new sort — confirming the fix
  does not regress the case where array-order and magnitude-order happen to agree).
- `src/lib/swing/thesis-health.test.ts`: 23/23 pass (both files together: 210/210).
- Full `npm test` (Node 20, `/opt/nvm/versions/node/v20.20.2/bin`, via `scripts/run-tests.mjs`):
  see PR for the final tally.
- `npx tsc --noEmit`: clean.

Tests run on Node 20 via `npx tsx --experimental-test-module-mocks --test <file>`.
