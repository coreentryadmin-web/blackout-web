# 2026-11-09: `GET /api/market/nighthawk/horizons?view=legacy` serves the FULL board, not the "all-empty board" its own comment claimed — documentation bug, fixed in place (Option B)

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/app/api/market/nighthawk/horizons/route.ts` lists `LEGACY` (and its aliases `PLAYBOOK`/
`TONIGHT`) as a known, validator-accepted `?view=` token (`isKnownNightHawkView` /
`KNOWN_NIGHTHAWK_VIEW_TOKENS`), and the route's own header comment claimed: *"LEGACY has no
horizon lane here ... so it scopes to an all-empty board."* That claim was never true and nothing
in the code ever implemented it — `?view=legacy` has always served the SAME complete board (real
ZERO_DTE lane + real SWING lane with live committed positions + the LEAPS placeholder) as omitting
`?view=` entirely. This is a documentation/contract bug, not a behavior bug: the fix corrects the
comment (and adds regression coverage pinning both the real behavior and the comment's accuracy),
not the runtime scoping logic. See "Fix rationale — why Option B" below for why behavior was left
unchanged.

## Root cause

`horizonForView(view)` (`nighthawk-view.ts`) returns `NIGHTHAWK_VIEW_META[view].horizon`, and
`NIGHTHAWK_VIEW_META.LEGACY.horizon === null` (LEGACY was never given a horizon-ledger lane — it's
the original evening-edition digest, served by a completely separate route). The route computes:

```ts
const horizon = viewParam ? horizonForView(parseNightHawkView(viewParam)) : null;
...
board = scopeBoardToHorizon(board, horizon);
```

`scopeBoardToHorizon(board, horizon)` (`horizon-board.ts`) has an explicit, DELIBERATE early
return: `if (horizon == null) return board;` — a documented no-op reserved for the "no `?view=`
param given" default (all-lanes) case; `horizon-board.test.ts`'s own pre-existing test even names
it `"scopeBoardToHorizon with null (legacy/all-lanes view) returns the board unchanged"`, and
`FINDINGS.md`'s own prior audit of this function states *"its `null` no-op is intentional — the
all-lanes view is meant to pass through untouched."*

Because `horizonForView("LEGACY")` is also `null`, `?view=legacy` collapses onto the EXACT SAME
`null` branch as "no `?view=` given at all" — there was never a second, LEGACY-specific "scope to
empty" code path for the route's comment to describe. The comment asserted a behavior that nothing
downstream (`horizonForView`, `scopeBoardToHorizon`, or the route itself) ever built.

## Live evidence

Confirmed live, authenticated (2026-11-09): `GET /api/market/nighthawk/horizons?view=legacy`
returned `order: ["ZERO_DTE","SWING","LEAPS"]` with `lanes.SWING.committed` populated with real,
live committed positions (LABD positionId 2484, CAVA positionId 2483, UVIX positionId 2482, ...)
— the full board, not an empty one. Byte-for-byte equivalent in shape to the same request with
`?view=` omitted entirely.

## Fix rationale — why Option B (fix the contract/docs), not Option A (make it actually scope to empty)

Read the real call sites before deciding:

- **No production caller relies on "empty" for this route+param combination.** The live
  `NightHawkFeed` UI's Legacy tab (`LegacyDeck` in `command-deck/containers.tsx`) fetches
  `/api/market/nighthawk/edition`, never this route. `HorizonDeck` (the only UI consumer of THIS
  route) is TypeScript-restricted to `horizon: "SWING" | "LEAPS"` — it is not reachable with
  `LEGACY`/`null`. Largo's `get_nighthawk_horizons` tool (`run-tool.ts` → `product-reads.ts`) takes
  no view/horizon argument at all, so Largo never requests this scoping either.
- **It is not a data leak.** `authorizeCronOrTierApi(req, "premium")` gates every `?view=` value on
  this route identically — a caller that asks for `?view=legacy` and gets the full board is getting
  a superset of data it is already entitled to see under the default/`?view=swings` requests,
  not information scoped to a different principal or tier.
- **Introducing a real "scope to empty" path (Option A) would add a new sentinel/branch to a
  shared, heavily-depended-on `horizon == null` no-op purely to satisfy a comment that was wrong in
  the first place**, for a parameter combination nothing live ever sends — scope disproportionate
  to a P3, and risks regressing the genuinely load-bearing "no `?view=` given → all lanes" default
  behavior that several other tests and the route's own `withLane`/rounding logic depend on.
- Conclusion: the honest, proportionate fix is to correct the comment (and the validator's implicit
  promise) to describe what the code has always actually, harmlessly done, and add regression
  coverage so a future reader doesn't "fix" the behavior toward the stale, false claim instead.

## Fix

- `route.ts`: rewrote the header comment to state the real contract — `?view=legacy` (and
  `playbook`/`tonight`) resolve through `horizonForView` to the same `null` horizon as the
  unscoped default, and `scopeBoardToHorizon(board, null)`'s documented no-op means `?view=legacy`
  deliberately serves the SAME full board, never an empty one — plus why that's harmless (same
  auth gate as every other `?view=`) and where LEGACY's real data actually comes from
  (`/api/market/nighthawk/edition`).
- `src/lib/horizon-board.test.ts`: new test pinning the ACTUAL, correct, unchanged composition —
  `horizonForView(parseNightHawkView(token))` for every LEGACY alias (`legacy`, `LEGACY`,
  `playbook`, `tonight`) resolves to `null`, and `scopeBoardToHorizon(board, null)` returns the
  identical full-board object (same reference, same non-zero `totalCommitted`).
- `src/app/api/market/nighthawk/horizons/route.test.ts`: new doc-sync test reading the route's own
  source text and asserting it no longer contains the false "scopes to an all-empty board" claim
  and does contain the corrected "same full, unscoped board" explanation — this is the test that
  gives a genuine RED→GREEN signal for a comment-only fix (see below).

## Evidence (RED → GREEN)

Behavior was intentionally NOT changed, so the behavioral test above (`horizon-board.test.ts`)
passes identically before and after — it pins the pre-existing, correct runtime behavior. The
genuine RED→GREEN proof is the doc-sync test in `route.test.ts`, isolated by swapping `route.ts`
for the pre-fix version (content-only, via a saved copy — `git show main:...route.ts` — rather
than a bare `git stash`, per this sandbox's shared-worktree stash caveat) and restoring it after:

- **RED** (route.ts at its pre-fix content, comment-only diff from the fix): `route.test.ts` — 8
  pass, 2 fail (both new doc-sync tests: "no longer claims LEGACY scopes to an empty board" and
  "explicitly documents the real, intentional full-board behavior" both failed against the old
  comment text).
- **GREEN** (route.ts restored to the fixed content): `route.test.ts` + `horizon-board.test.ts` +
  `nighthawk-view.test.ts` together — 41/41 pass.
- `npx tsc --noEmit` — clean.

Run on Node 20.20.2 via
`npx tsx --experimental-test-module-mocks --test <files>` per the repo's CLAUDE.md.

## Blast radius

One file's comment (`route.ts`) + two new regression tests. No runtime behavior changed anywhere
— `horizonForView`, `scopeBoardToHorizon`, `withLane`, and every other `?view=` value's behavior
on this route are byte-for-byte unchanged. No other route or doc repeats the specific false claim
("scopes to an all-empty board") — checked via repo-wide grep.
