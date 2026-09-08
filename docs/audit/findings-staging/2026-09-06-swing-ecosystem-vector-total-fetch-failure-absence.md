> **kind:** `FINDING`

## A total ecosystem/Vector fetch failure was indistinguishable from legitimately-empty data — never reached the structured unavailableSources channel — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (HIGH per source audit — Largo contract C3 violation) |
| **Area** | Night Hawk Swings — Ask Largo play-brief, `play-brief-context.ts` / `play-brief-absence.ts` |
| **PR** | (pending) |

### Symptom

Audit finding #11 (`docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md`): `unavailableSources`
plumbing (`collectBriefUnavailableSources`) only covered the case where `fetchEcosystemContext`
SUCCEEDS but one of its internal legs (peers, earnings, etc.) is honestly thin — that path already
forwards `ctx.ecosystem?.arsenal?.unavailable_sources`. It did NOT cover the case where the WHOLE
`fetchEcosystemContext(ticker)` or `fetchVectorFullState(...)` call throws/times out — both were
wrapped in `.catch(() => null)` in `play-brief-context.ts` with no signal captured anywhere, so a
hard fetch failure was structurally indistinguishable from "legitimately nothing to report" —
exactly the class of absence-not-disclosed bug the Largo C3 principle exists to prevent. (The
`openBook` field already carried this distinction correctly — `null` means the ledger read failed,
distinct from `[]` meaning genuinely no other positions — this fix brings `ecosystem`/`vector` to
the same standard.)

The audit also noted `hasRichData`/`confidence.level` could still read "high" under a total
failure; that half of the finding was already resolved independently (PR #4174 omitted
`envelope.confidence` from the swing brief entirely rather than deriving it, so there is no
fabricated-confidence path left to fix here).

### Fix

Added `ecosystemFetchFailed`/`vectorFetchFailed` booleans to `SwingPlayBriefContext`, set in
`loadSwingPlayBriefContext`'s `.catch()` handlers (previously discarded the error entirely), and
read by `collectBriefUnavailableSources()` to push `{source: "ecosystem context", reason: "fetch
failed"}` / `{source: "Vector state", reason: "fetch failed"}` — same shape and same function as
the existing HELIX/open-book/Meridian/option-mark absence entries.

### Evidence (RED → GREEN)

Added 3 tests to `play-brief-absence.test.ts`: ecosystem fetch-failure surfaces, ecosystem
`null` WITHOUT a fetch failure does NOT fabricate an entry (the negative case that proves this
isn't just always-on), and Vector fetch-failure surfaces. Proof via `git stash` on the three
source files (Node 20): RED — 2/10 fail. GREEN (post-fix): 10/10 pass.

Full `src/lib/swing/*.test.ts`: 655/655 pass. `npx tsc --noEmit`: clean.

### Blast radius

Two new optional context fields (additive, no existing consumer reads them), one loader function,
one absence-aggregation function. `hasRichData`/`confidence` logic no longer exists in
`play-brief.ts` (removed by #4174) — nothing to change there.
