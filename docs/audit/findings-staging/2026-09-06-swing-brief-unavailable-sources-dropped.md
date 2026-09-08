# Ask Largo swing brief silently drops `arsenal.unavailable_sources` — violates the BIE/Largo absence contract

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (data-honesty gap, not a crash) |
| **Area** | Swing / Ask Largo play brief, shared BIE rich-narrative envelope builder |
| **Files** | `src/lib/bie/rich-narrative.ts`, `src/lib/swing/play-brief.ts`, `src/lib/swing/play-brief.test.ts` |

## Context

Continuing the operator's standing "own this feature, dig hard into every aspect" mandate for Ask
Largo's swing integration, this sweep audited the swing brief against
`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points — specifically **absence** ("a source that
was requested but is unavailable must be surfaced, never silently dropped").

## Root cause

`fetchEcosystemContext` (`src/lib/bie/ecosystem-context.ts`) already builds an honest
`arsenal.unavailable_sources: EcosystemArsenalUnavailable[]` array (`{source, reason}`) for
requested-but-thin data legs — its own doc comment states this explicitly: *"Requested-but-thin
legs are surfaced in `arsenal.unavailable_sources`, never fabricated and never silently dropped
(§4)."* `BieAnswerEnvelope` (`src/lib/bie/answer-envelope.ts`) has carried a matching top-level
`unavailableSources?: BieUnavailableSource[]` field since the envelope contract shipped, and the UI
(`BieAnswer.tsx`) already renders it via `UnavailableChip`, surfaced prominently above the
sections — this is a fully-built, working feature end to end.

**Except the wire between them was missing.** `buildRichEnvelope()` — the single shared
constructor every rich deterministic BIE composer (concept answers, the swing play brief) routes
through — never accepted or forwarded an `unavailableSources` input to the underlying
`makeEnvelope()` call, even though `makeEnvelope`'s own input type already supports the field.
`composeSwingPlayBrief` therefore had no way to pass `ctx.ecosystem?.arsenal?.unavailable_sources`
through even if it wanted to — and it didn't try. Net effect: every swing brief with a thin/failed
upstream data leg (a slow short-interest provider, a Benzinga news timeout, etc.) presented that
absence as silence rather than an honest chip, which reads to the trader as "there is no such
data" rather than "we tried and it was unavailable this read" — exactly the failure mode the
Largo Product Contract's absence principle exists to prevent.

## Fix

- `rich-narrative.ts`: `BuildRichEnvelopeInput` gains an optional `unavailableSources?:
  BieUnavailableSource[]`, forwarded straight into `makeEnvelope(...)`. Additive — every existing
  caller (`concept-narrative.ts`) is unaffected since the field is optional and previously always
  implicitly `undefined`.
- `play-brief.ts`: `composeSwingPlayBrief`'s `buildRichEnvelope({...})` call now passes
  `unavailableSources: ctx.ecosystem?.arsenal?.unavailable_sources` through.

No new UI, no new type — this closes an existing, fully-built pipe that was disconnected at one
join.

## Evidence (RED → GREEN)

New test in `play-brief.test.ts`: builds a context whose `arsenal.unavailable_sources` carries one
entry (`{source: "short-interest", reason: "provider timeout"}`) and asserts
`brief.envelope.unavailableSources` deep-equals it. `git stash` on the two source files →
**fails** (`envelope.unavailableSources` is `undefined`). Restored → **passes**. `tsc --noEmit`
clean. Full `npm test` in progress at write time (Node 20), rebased against
`main@b78270d99` (post #4084/#4093).

## Blast radius

- `concept-narrative.ts` — the only other `buildRichEnvelope` caller — is unaffected (new field is
  optional, not passed, defaults to `undefined` exactly as before this change).
- `makeEnvelope`/`BieAnswerEnvelope`/`BieAnswer.tsx`/`UnavailableChip` are all unchanged — this fix
  is purely the missing forward, not new plumbing.
- Every existing swing-brief test/fixture that doesn't set `unavailable_sources` (or sets it to
  `[]`) is unaffected — `envelope.unavailableSources` is `undefined`/`[]` exactly as it always
  rendered (no chip), matching current behavior.
- Independent of Cursor's #4084 narrative work — different files, different call sites within
  `play-brief.ts` (the `buildRichEnvelope` options object, not the sections array).

## Fix rationale — what was deliberately left unchanged

- Did not also wire `unavailableSources` into `concept-narrative.ts` — that composer has its own
  data-sourcing model and no `unavailable_sources`-shaped input on hand today; adding it
  speculatively there would be scope creep beyond what this sweep verified is missing.
- Did not add a NEW section for this — `BieAnswer.tsx`'s existing `UnavailableChip` rendering
  (rendered above sections, per BIE §4: "surfaced up top, never hidden") is the correct, already-
  designed home for this data; duplicating it as a text section would fight the existing UI
  convention rather than use it.
