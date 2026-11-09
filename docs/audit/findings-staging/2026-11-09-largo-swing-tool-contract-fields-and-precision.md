# Largo's live get_swing_play_brief tool never applied adaptSwingBriefToLargo — contract fields and distancePct precision missing from every chat answer

> **kind:** `FINDING`

## Status

FIXED

## Root cause

Two related gaps in `src/lib/largo/swing-play-brief-read.ts`'s `swingPlayBriefForLargo` — the
function `src/lib/largo/run-tool.ts`'s `get_swing_play_brief` tool case dispatches to for every
live Largo chat answer about a Swing position:

**C2 — missing contract fields.** `composeSwingPlayBrief`'s real per-source staleness
(`dataAgeMs`) is only bucketed into the Largo contract's required freshness enum
(`live`/`delayed`/`cached`/`snapshot`/`stale`) + `age_seconds`, and only produces normalized
`direction`/`evidence_numbers`/`source`/`cohort`, inside `adaptSwingBriefToLargo`
(`src/lib/swing/play-brief-adapter.ts`). That adapter has exactly one caller repo-wide before this
fix: `src/app/api/market/swing/play-brief/route.ts` (the Command Deck UI's HTTP route).
`swingPlayBriefForLargo`'s success path returned `roundFloats({ available: true, ...brief })`
verbatim — it never imported or called the adapter, since the tool's creation (PR #4829,
2026-09-11) through two later touches. A live Largo chat answer therefore received the raw
`dataAgeMs` millisecond integer (or `null`) under a non-contract key, with no freshness
classification and no documented way for the model to interpret it — `tool-defs.ts`'s tool
description only points at the brief's own narrative "data freshness" prose.

**C9 — distancePct double-rounds.** Every `StructureLadder` rung's `distancePct` is narrated in
the brief's own markdown via `fmtPct()` (1dp default), so the HTTP route rounds the wire value to
the SAME 1dp precision (`roundFloats(payload, 2, { distancePct: 1 })`) specifically to avoid a
double-round disagreeing with the narrative at a half-unit boundary (the 2026-10-08 FINDINGS.md
fix). `swingPlayBriefForLargo`'s `roundFloats` call passed no `dp`/`keyDp` at all, so `distancePct`
got the generic 2dp default instead — the one further rounding pass the Largo-tool path goes
through (`roundResultForReading`, 4dp for values >=1) is strictly coarser and can't correct it.

Both gaps were independently confirmed by an adversarial-verify pass (Ask Largo standing mandate,
code-level contract-conformance probe) that traced every call site and ruled out duplicate/already-
fixed status: a 2026-10-20 fix (PR #6284) assumed `swing-play-brief-read.ts` "calls the HTTP
route... so it inherits the fix automatically" — factually wrong at every revision of the file,
which has never made an HTTP call or imported the adapter.

## Evidence (RED → GREEN)

Added to `src/lib/largo/swing-play-brief-read.test.ts` (mocking `play-brief-adapter`'s
`adaptSwingBriefToLargo` alongside the pre-existing `play-brief-context`/`play-brief` mocks, with a
default `ok:true` stub so every pre-existing test keeps passing unmodified):

- `calls adaptSwingBriefToLargo with the composed brief and merges its Largo contract fields onto
  the response` — RED (pre-fix): the adapter mock was never invoked at all, and none of
  `as_of`/`freshness`/`age_seconds`/`direction`/`evidence_numbers`/`source`/`cohort` appeared on the
  response. GREEN post-fix.
- `falls back to the honest unavailable shape when adaptSwingBriefToLargo itself reports ok:false`
  — new coverage for a path that didn't exist pre-fix.
- `distancePct gets the narrative's 1dp precision, not the generic 2dp default` — RED (pre-fix):
  `2.625` rounded to `2.63` (2dp); GREEN (post-fix): rounds to `2.6` (1dp), matching the HTTP
  route's own override.

Post-fix: 9/9 tests in `swing-play-brief-read.test.ts` (6 pre-existing + 3 new). Consumer suites
re-run clean: `run-tool.test.ts`, `product-adapters.test.ts`, `play-brief-adapter.test.ts` —
47/47 pass. `npx tsc --noEmit` clean.

## Blast radius

`swingPlayBriefForLargo` has exactly one production caller, `run-tool.ts`'s `get_swing_play_brief`
tool case. `product-adapters.ts`'s `swingContribution` (feeds `get_cross_product_read`) reads this
function's output but only off `envelope.bias`/`playId`/`engine`/`available`/`note` — none of the
newly-added top-level fields — so it is unaffected either way; confirmed via its own 47-test suite
staying green.

## Fix rationale

Mirrored `route.ts`'s existing adapter-call + field-merge + precision-override pattern exactly,
rather than inventing a second shape, so both paths describe the same instant through identical
logic — the file's own header comment already states this as the design intent ("calls the EXACT
SAME resolve -> compose pipeline the route uses... never a second, drifting copy"); this fix
extends that same discipline to the adapter step, which had drifted out of step with it. Kept
additive — the native `...brief` spread is untouched, only new top-level keys are added, per the
Largo contract's "ADDITIVE, never flatten" rule. The `ok:false` branch falls back to the same
`unavailable` shape every other failure path in this file already uses.
