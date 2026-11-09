# 2026-11-09: Night Hawk Legacy BACKFILL-tier plays never got `exit_style`/`risk_note`/`dte` — live trade management silently fell back to the wrong exit model, and the plays were permanently excluded from banger shadow grading

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

Night Hawk Legacy's BACKFILL-tier edition plays (the ranked-pool merit fill `selectBackfillPlays`
produces when the organic path leaves the edition below the ops minimum) never got `exit_style`,
`risk_note`, or `dte` fields — unlike organically-qualified ("QUALIFIED") banger plays, which get
all three from `buildPlay` (`deterministic-edition.ts`). This has two real downstream
consequences, not just a missing cosmetic field:

1. **Live trade management falls back to the wrong model.** `legacy-live-sync.ts`'s
   `runLegacyLiveSync` branches on `row.exit_style === "scale_out"` (~line 199): true routes to
   `deriveScaleOutAction` (the banger ladder — bank 50% at 2x, trail the runner at 50% of its
   peak, hard stop −60%); false/absent falls through to `deriveLegacyPlanAction`, the 0DTE
   grinder's plan model (`stop_pct:-50`, `target_pct:100`, a single trim, no trailing runner) —
   wrong for a genuine banger-ticker swing. A real, currently-open position (TLN, $360 CALL,
   expiry 2026-11-20, entered 2026-11-04 @ $22.60, confirmed still CONFIRMED/open via
   `GET /api/nighthawk/play-status?date=2026-11-04`) is a live example of a BACKFILL-tier play
   that could never be managed under the correct model no matter which ticker it was, because the
   structural wiring to even check didn't exist.
2. **Permanent grading exclusion.** `play-outcomes.ts`'s `resolveBangerScaleOutGrades` (~lines
   796-836) calls `resolveBangerGradeRequest({ exit_style: play.exit_style, ... })`; when
   `exit_style` is absent the resolution is `"not_banger"` and the row's `scale_out_grade` is
   pinned permanently NULL — every BACKFILL-tier play was silently excluded from the banger
   shadow track-record grading forever, regardless of whether its ticker genuinely was a
   breakout/banger name.

## Root cause

`play-backfill.ts`'s `selectBackfillPlays` (the sole producer of BACKFILL-tier plays, called from
`backfillThinEditionPlays`, which has 4 live call sites — 3 in `edition-builder.ts`, 1 in
`post-publish-backfill.ts`'s `republishBackfilledEdition`) built its play object via
`mapClaudePlayToEdition` (`claude-edition.ts`) plus only a `thesis`/`rr_ratio` override — neither
function ever set `dte`, `risk_note`, or `exit_style`. `bangerTickers` (the `Set<string>` of
whole-market breakout movers that drives the organic path's decision) was never even a parameter
of `selectBackfillPlays`/`backfillThinEditionPlays` — the gap wasn't a wrong threshold or stale
data, it was that the signal never reached this code path at all.

By contrast, the organic path's `buildPlay` (`deterministic-edition.ts`, ~lines 810-935) DOES
take a `bangerTickers` parameter (sourced from `ctx.breakout_movers`, computed once in
`generateEditionPlays`, `claude-edition.ts`) and:
- computes `dte` **unconditionally** for every play that resolved a real contract (its own
  comment: "observational only, never read by selection/scoring" — this is NOT gated on banger
  status, contrary to how the bug report that prompted this fix initially described it);
- sets `risk_note`/`exit_style` **only** inside an `if (bangerTickers?.has(ticker))` block, via
  the shared `bangerScaleOutNote()` helper (`scale-out.ts`), verifying the contract's actual
  moneyness (`otm`, strike vs spot) rather than assuming it.

This is the same root-cause family the codebase already fixed once for `rr_ratio`
(`docs/audit/FINDINGS.md`, 2026-10-25 entry — that fix's own write-up explicitly says "Deliberately
did not change `mapClaudePlayToEdition` itself"), so `dte`/`risk_note`/`exit_style` were left out
of scope then and never revisited.

**Correction to the bug report that prompted this fix:** the report's root-cause section implied
`dte` was gated on banger status the same way `risk_note`/`exit_style` are ("the organic path's
`buildPlay`... DOES... conditionally set... when the ticker is in that set" — lumping all three
together). Reading the actual source shows `dte` is unconditional in `buildPlay`; only
`risk_note`/`exit_style` live inside the banger-gated block. This fix mirrors `buildPlay`'s real
behavior exactly: `dte` is now populated for **every** BACKFILL play with a resolved contract
(banger or not — every BACKFILL play has one by construction), while `risk_note`/`exit_style`
remain gated on `bangerTickers` membership, matching the organic path's own conditional.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only `play-backfill.ts`): 2/37 tests failed in
`play-backfill.test.ts` (the two new regression tests) — `exit_style` read `undefined` instead of
`"scale_out"` for a banger-ticker BACKFILL play, and `dte` read `undefined` for a BACKFILL play
with no `bangerTickers` passed at all. 35/37 pre-existing tests in that file were unaffected.

Separately, via `git stash` isolating only `post-publish-backfill.ts`: 5/14 tests failed in
`post-publish-backfill.test.ts` (`bangerTickersFromContextJson` not exported/defined, and the
source-text wiring assertion that `republishBackfilledEdition` fetches the job context and threads
`bangerTickers` into `backfillThinEditionPlays`).

GREEN (post-fix): `play-backfill.test.ts` 37/37 pass; `post-publish-backfill.test.ts` 14/14 pass;
the full sibling edition-builder/claude-edition/deterministic-edition/play-backfill-merit test
files (148 tests) pass; `npx tsc --noEmit` clean.

Live confirmation of the gap (from the bug report that prompted this fix): `GET
/api/nighthawk/play-status?date=2026-11-04` shows the TLN $360 CALL position (entered 2026-11-04 @
$22.60, expiry 2026-11-20) as CONFIRMED/open — a live BACKFILL-tier position whose live management
model depended entirely on a field (`exit_style`) that `selectBackfillPlays` had no way to ever
set.

## Fix

Wired `bangerTickers` into `selectBackfillPlays`/`backfillThinEditionPlays` and threaded it
through all 4 call sites:

- **`play-backfill.ts`**: `pickAffordableChainContract` now also returns `strike`/`expiry`
  (purely additive — previously only encoded inside the formatted `options_play` string).
  `selectBackfillPlays` takes a new optional `bangerTickers?: Set<string>` param; computes `dte`
  unconditionally via `calendarDteBetween` (same helper `buildPlay` uses); and, when the ticker is
  in `bangerTickers`, sets `risk_note = bangerScaleOutNote({ dte, otm })` and
  `exit_style = "scale_out"` — reusing the exact same `bangerScaleOutNote` helper `buildPlay`
  calls, including its real-moneyness `otm` check, so the two paths can never diverge in
  wording/logic again. `backfillThinEditionPlays` takes the same param and passes it through.
- **`edition-builder.ts`** (3 call sites inside `buildEveningEdition`): computes
  `bangerTickers = new Set((ctx.breakout_movers ?? []).map(...))` once, right after `ctx` becomes
  non-null (the same derivation `generateEditionPlays`/`claude-edition.ts` already does from the
  same `ctx` for the organic path), and passes it to every `backfillThinEditionPlays` call.
- **`post-publish-backfill.ts`** (`republishBackfilledEdition`, the 4th call site): this path has
  no `MarketWideContext` in scope at all — it reconstructs everything from durably-persisted DB
  rows, never re-fetches market data. Added `bangerTickersFromContextJson()`, which reads the
  original night's `nighthawk_jobs.context_json` (fetched via `fetchNighthawkJob(editionFor)`) —
  the exact `MarketWideContext` the pipeline fetched at STAGE 1 that night, never cleared by
  `clearNighthawkStaging` (which only deletes `nighthawk_dossiers_staging` rows), so it persists
  for this `edition_for` indefinitely. Fails soft to an empty `Set` (never throws) when the job
  row or its `context_json` is missing/malformed.

Deliberately left unchanged: `repairStaleBackfillPlays` (the contract-repair-only path, distinct
from play *creation*) does not set these fields either and is out of scope here — see Blast
radius below.

## Blast radius

- Every BACKFILL-tier Legacy play whose ticker is a genuine whole-market breakout mover now gets
  the same scale-out exit guidance an organically-qualified banger play gets — fixing both the
  live trade-management fallback (`legacy-live-sync.ts`) and the permanent grading exclusion
  (`play-outcomes.ts`'s `resolveBangerScaleOutGrades`) for that population going forward.
- Every BACKFILL-tier play (banger or not) now also carries a real `dte`, matching the organic
  path's unconditional behavior — this field was previously always absent for BACKFILL plays.
- **Known, deliberately out-of-scope sibling gap**: `repairStaleBackfillPlays`
  (`play-backfill.ts`), which swaps a stale/expired BACKFILL contract for a live one on an
  already-published edition, does not recompute `dte`/`risk_note`/`exit_style` when it swaps
  contracts — a repaired play's `dte` can go stale relative to its new contract's expiry, and a
  play created before this fix shipped stays without `exit_style`/`risk_note` even after a later
  repair pass. Not fixed here to keep this PR single-issue (`repairStaleBackfillPlays` has no
  `bangerTickers` in scope either, and plumbing it in is a separate, reviewable change) — worth a
  follow-up finding if it matters in practice.
