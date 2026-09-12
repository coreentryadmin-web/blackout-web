# Swing "Desk context" narrated a weeks-old Legacy pick as live sizing context, contradicting its own unavailableSources chip

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (Largo-visible product-correctness defect — misleading live-sounding guidance in the member-facing narrative) |
| **Area** | Ask Largo / Night Hawk Swings play-brief — `src/lib/swing/play-brief-intel.ts` (`deskConsensusSection`, the "Desk context" section) |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — live play-brief deep-dive (weekend health-check cycle) |

## Root cause

`deskConsensusSection` reads `eco.nighthawk_recent` — "the last time this ticker appeared in a
Night Hawk Legacy edition," queried with `ORDER BY edition_for DESC LIMIT 1` and **no date
filter** (same underlying data source documented in `play-brief-absence.ts`'s own 2026-09-10 fix
comment) — and narrated it **unconditionally**, with no staleness gate at all:

> "Night Hawk Legacy's last pick on this name (**\<edition_for>**) is still **unresolved** —
> weigh that track record against today's **\<direction>** setup before sizing."

Live reproduction (2026-09-12, GOOGL WATCH brief): `edition_for` read **2026-08-26** — 17 days
before the request's own `sessionDate` (2026-09-12) — and the section still told the member to
"weigh that track record ... before sizing" as if it were current context.

The same payload's own `unavailableSources` array (the honest absence-chip, fixed 2026-09-10 for
this **exact** staleness pattern — its own comment cites a 5-week-old GOOG example) correctly
labeled the identical fact:

> `"Night Hawk Legacy": "no recent Legacy edition for this ticker (last featured 2026-08-26)"`,
> `retryable: false`

So the chip and the narrative section **disagreed about the same data in the same response**: the
chip says "this is stale, non-retryable population fact," the section says "weigh this before
sizing" as though it were fresh. This is exactly the "wrong/misleadingly-presented identity is
worse than an obviously-missing one" failure mode the 2026-09-10 absence-chip fix targeted — it
was fixed at the chip layer but not at the narrative layer that actually renders the visible,
Largo-quotable sentence.

## Fix

`deskConsensusSection` now takes an optional `sessionDate` parameter (defaults to `null`, so any
existing caller that doesn't pass one keeps its current unconditional behavior — no regression).
The real caller (`composeSwingPlayBrief`'s section builder) now passes `ctx.sessionDate`. When a
`sessionDate` is supplied, the function computes the same `daysBetweenYmd(nh.edition_for,
sessionDate)` gap the absence-chip fix already uses and, mirroring that fix's own bound (a normal
within-week gap, incl. weekends), suppresses the section entirely once the gap exceeds 4 days —
beyond that window the Legacy pick is a population fact about this ticker's feature history, not
useful "before sizing" context, so it's dropped rather than asserted as current.

## Why suppress rather than reword

The absence-chip fix already established the honest framing for "this ticker just hasn't come up
in Legacy recently" (non-retryable, no actionable next step). Reusing that exact bound here keeps
the two code paths in agreement by construction instead of inventing a second staleness rule that
could drift from the first. A stale pick has no useful incremental "weigh this before sizing"
value once it's outside a normal within-week window — dropping the section (same shape as every
other bucket-blind/absence section in this file) is simpler and safer than trying to reword a
17-day-old fact into something honestly actionable.

## Evidence / tests

Added to `src/lib/swing/play-brief-intel.test.ts`:
- a stale (17-day-gap) Legacy pick is suppressed (`null`) when `sessionDate` is supplied —
  reproduces the live GOOGL case.
- a recent (2-day-gap) Legacy pick still narrates normally when `sessionDate` is supplied.
- omitting `sessionDate` (the default) preserves the prior unconditional behavior, so every
  pre-existing test in this file (which constructs the section without a `sessionDate`) is
  unaffected.

Verified RED before the fix (`git stash` on `play-brief-intel.ts` alone, keeping the new tests):
1 fail. GREEN after: 102/102 `play-brief-intel.test.ts` pass. `tsc --noEmit` clean.

## Blast radius

Single call site (`composeSwingPlayBrief`) and single function (`deskConsensusSection`) — no
other consumer of `nighthawk_recent` narrates it into a member-facing sentence the same way (the
absence-chip path in `play-brief-absence.ts` already had its own correct staleness bound from
2026-09-10; this PR brings the narrative path into agreement with it, it does not touch it).
