# Swing play-brief's rollHistory and tickerTrackRecord collapse a real upstream timeout into the same null as honest absence

> **kind:** `FINDING`

## Status

FIXED

## Root cause

`src/lib/swing/play-brief-context.ts`'s `loadSwingPlayBriefContext` races several best-effort
reads against an 8s budget via `withBriefSourceTimeout`, which REJECTS on timeout specifically so
a caller can distinguish a real upstream stall from honest absence. `ecosystemFetchFailed`/
`vectorFetchFailed` (original) and `archetypeTrackRecordFetchFailed` (added 2026-10-21 for a live
EWY repro) already make that distinction for their own sources — each sets a companion boolean
flag inside its `.catch((err) => { ...; xFetchFailed = true; return null; })` handler.

`loadRollHistory` (line 330) and the `tickerTrackRecord` read (lines 339-347) used the
byte-identical `withBriefSourceTimeout(...).catch(() => null)` shape WITHOUT any companion flag —
confirmed by grep, no `rollHistoryFetchFailed`/`tickerTrackRecordFetchFailed` existed anywhere in
the codebase. A genuine upstream stall on either read (this file's own header cites a measured
2026-09-09 incident with ALB p99 90-104s) therefore read identically to "this play was never
rolled" or "no prior trades on this ticker" — the exact C3 hazard
`docs/audit/LARGO-PRODUCT-CONTRACT.md` calls out: "No data and no signal are different claims. A
consumer that cannot tell them apart will report absence as a finding... even when every test
passes."

The file's own top-of-file comment was stale on this point — it stated only ecosystem/vector carry
the `*FetchFailed` distinction and that "the archetype-track-record read has no such distinction to
make," contradicted by `archetypeTrackRecordFetchFailed` added later in the same file, which was
never extended to these two siblings using the identical pattern.

## Evidence (RED → GREEN)

Added to `src/lib/swing/play-brief-absence.test.ts`, mirroring the existing
`archetypeTrackRecordFetchFailed` test pair exactly:

- `collectBriefUnavailableSources: a genuine roll-history fetch failure (timeout) surfaces in
  envelope, distinct from a legitimate 'never rolled' absence` and its `tickerTrackRecord` sibling —
  RED without the new disclosure blocks in `play-brief-absence.ts` (no entry ever produced);
  GREEN with them.
- `collectBriefUnavailableSources: rollHistory/tickerTrackRecord null WITHOUT a fetch failure does
  not fabricate an absence entry` — regression guard preserving Largo C6 (omission, not
  fabrication) for the legitimate-absence case.

Post-fix: 121/121 tests in `play-brief-absence.test.ts` pass. `npx tsc --noEmit` clean.

## Blast radius

`rollHistoryFetchFailed`/`tickerTrackRecordFetchFailed` are new optional fields on
`SwingPlayBriefContext` (`play-brief-types.ts`) — additive, no existing field removed or
retyped. `collectBriefUnavailableSources` (`play-brief-absence.ts`) is the only consumer that
needed a new branch; every other reader of `SwingPlayBriefContext` is unaffected since the fields
are optional and `undefined` on any fixture predating them reads as "unknown," matching the
existing convention for `archetypeTrackRecordFetchFailed`.

## Fix rationale

Copied the already-reviewed, already-shipped `archetypeTrackRecordFetchFailed` pattern verbatim
for its two remaining siblings — same `console.warn` + flag-set shape in `play-brief-context.ts`,
same optional-boolean doc-comment convention in `play-brief-types.ts`, same disclosure-block shape
in `play-brief-absence.ts` (source name / "fetch failed" / `what_is_missing` / `retryable: true`).
Also corrected the top-of-file comment in `play-brief-context.ts` that had gone stale claiming
archetype-track-record was uniquely exempt from this distinction.
