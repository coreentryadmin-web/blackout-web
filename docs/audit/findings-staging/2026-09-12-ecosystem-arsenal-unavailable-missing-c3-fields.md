# Largo C3 gap survived #4861 one layer up — `ecosystem-context.ts`'s own `unavailable_sources` push sites never got `what_is_missing`/`retryable`

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (C3-contract completeness gap, not a live-incorrect value — the reader was honestly reporting absence, just without the two new required-in-spirit fields) |
| **Area** | `src/lib/bie/ecosystem-context.ts` (`assembleEcosystemArsenal`'s 7 `unavailable.push(...)` sites); reached via `src/lib/swing/play-brief-absence.ts:313`'s `[...ctx.ecosystem?.arsenal?.unavailable_sources]` spread and `src/lib/bie/ticker-verdict.ts`'s equivalent read |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — live envelope-completeness check on a fresh swing play-brief (EWZ, positionId 29, closed) during the 5-engine live-monitor cycle |

## Root cause

PR #4861 (merged earlier this same cycle window) added optional `what_is_missing`/`retryable`
fields to `BieUnavailableSource` (`answer-envelope.ts`) and populated them at every one of
`play-brief-absence.ts`'s own ~18 `unavailableSources.push(...)` call sites — but that file does
not build the array from scratch. Its very first line,

```ts
const out: BieUnavailableSource[] = [...(ctx.ecosystem?.arsenal?.unavailable_sources ?? [])];
```

seeds `out` with whatever `EcosystemArsenal.unavailable_sources` already contains, built entirely
inside a **different** file — `src/lib/bie/ecosystem-context.ts`'s `assembleEcosystemArsenal()`.
That function's own `EcosystemArsenalUnavailable` type was `{ source: string; reason: string }`
only, and every one of its 7 push sites (`earnings`, `fundamentals/short-interest`, `peers`,
`macro backdrop`, `breadth`, and two `news` sites) pushed exactly that bare shape. TypeScript's
structural typing let the spread compile cleanly against the now-widened `BieUnavailableSource[]`
(the two new fields are optional), so nothing caught this at the type layer — the array just
silently carried entries missing the fields #4861 was written to guarantee.

**Live-verified same cycle**: `GET /api/market/swing/play-brief?playId=SWING:EWZ&ticker=EWZ&positionId=29&status=CLOSED`
returned
```json
"unavailableSources": [
  {"source": "earnings", "reason": "no upcoming date"},
  {"source": "peers", "reason": "none found"}
]
```
— both entries with neither field, on a live request served *after* #4861 was already on `main`,
confirming the gap reaches production today, not just in theory.

## Blast radius

`ecosystem.arsenal.unavailable_sources` is read by **two** composers, not one:
`src/lib/swing/play-brief-absence.ts` (swing play-brief, fixed here) and
`src/lib/bie/ticker-verdict.ts` (grep-confirmed, same spread pattern) — so this fix, applied at
the shared reader layer rather than re-patched per-consumer, corrects both at once. This is the
same "fix at the shared layer, not the call site" shape the prior `buildRichEnvelope()`
`unavailableSources`-forwarding fix (#4101, referenced in this repo's CLAUDE.md) already
established as the right pattern for this exact kind of gap.

## Fix

Widened `EcosystemArsenalUnavailable` to carry the same two optional fields as
`BieUnavailableSource`, then populated both at all 7 push sites, classifying `retryable` by
whether the absence is a live-fetch miss (retry can succeed: `macro backdrop`, `breadth`, both
`news` sites) or a provider-graph/dataset absence that will not change moment-to-moment (retry is
futile: `earnings`, `fundamentals/short-interest`, `peers`) — same retryable/structural split
`play-brief-absence.ts` itself already uses (per its own #4861 commit message).

## Evidence / tests

New test in `ecosystem-context.test.ts` asserts every entry from a realistic single-name AND
index-scope call carries both fields, and spot-checks the retryable/structural split lands where
the reasoning above says it should. RED (pre-fix, via `git stash` on `ecosystem-context.ts` only):
1 failure — `earnings is missing what_is_missing`. GREEN post-fix: 33/33 `ecosystem-context.test.ts`,
plus the full targeted sweep (`ecosystem-context.test.ts` + `play-brief-absence.test.ts` +
`ticker-verdict.test.ts` + `play-brief.test.ts`, 132 tests) all pass — confirming the widened type
doesn't disturb either downstream consumer's own fixtures (both hand-build their own
`arsenal.unavailable_sources` fixtures rather than calling `assembleEcosystemArsenal`, so they were
never exercising this bug or at risk from the fix). `tsc --noEmit` clean.
