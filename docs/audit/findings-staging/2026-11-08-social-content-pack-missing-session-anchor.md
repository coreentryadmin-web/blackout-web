> **kind:** FINDING

## Largo social-content-pack stamped a UTC instant with no C1 ET session anchor — FIXED

**Status:** FIXED (regression test added, RED→GREEN proven).

### Root cause

`src/lib/largo/social-content-pack.ts`'s `buildSocialContentPack()` — the prefetched facts block
Largo cites when a member asks it to draft an X/social post about today's winners, losers, board
P&L or SPX read (`src/lib/largo-terminal.ts`'s `questionWantsSocialContentPack` path) — stamped
`as_of: new Date().toISOString()` and carried no field anywhere in `SocialContentPack` that
resolves the ET trading session that instant belongs to.

This is exactly the defect class the Largo contract's C1 rule
(`src/lib/largo/contract/session-anchor.test.ts`) exists to ratchet out, per that file's own
header (three earlier real bugs: #2418, #2420, #2422). A bare UTC ISO instant is unambiguous as a
moment in time, but after ~20:00 ET the UTC *calendar date* is already tomorrow, so anything —
a human or a model — resolving "today's winners" purely from `as_of`'s own date reads a full
session ahead for roughly the last four hours of every RTH day. For this specific payload the
practical failure mode is concrete: a post drafted late in the session citing "today's winners"
would, read naively, claim tomorrow's calendar date for plays that closed today.

The file was a listed, acknowledged `KNOWN_GAPS` entry in `session-anchor.test.ts`
(`"src/lib/largo/social-content-pack.ts": "coordinator — member-visible copy"`) since the guard
was tightened on 2026-08-21 — a real gap waiting on an owner, not an exemption on the merits (the
test file's own docblock: "Each is a real gap and a work item for its owning lane — NOT an
exemption on the merits").

### Fix

Additive, matching the same pattern already used for the OHLC-bar case (`bar-session-date.ts`)
and the two sibling fixes on this same contract (PR #7593 Meridian timeline, and the
polygon-news fix in flight): add a `session_date: string | null` field to `SocialContentPack`,
derived from the *same* `Date.now()` instant `as_of` is built from (via one shared `nowMs`
variable, so the two can never describe different moments), using the shared `etSessionDate()`
helper (`@/lib/largo/temporal/bar-session-date`). `as_of` is kept exactly as before — the fix
never removes or reshapes the UTC instant, it only adds the anchor beside it.

Removed `src/lib/largo/social-content-pack.ts` from `session-anchor.test.ts`'s `KNOWN_GAPS` map,
since it is now genuinely anchored (the ratchet's own "list SHRINKS" test enforces this isn't
left stale).

### Evidence (RED → GREEN)

1. **RED** — reverted `social-content-pack.ts` alone (new test + mocks kept):
   ```
   not ok 3 - buildSocialContentPack: carries an ET session_date anchor beside as_of
     The input did not match the regular expression /^\d{4}-\d{2}-\d{2}$/. Input: ''
   # pass 3
   # fail 1
   ```
2. **GREEN** — restored the fix:
   ```
   # tests 4
   # pass 4
   # fail 0
   ```
3. The contract's own ratchet (`session-anchor.test.ts`, 6 tests) passes clean with the
   `KNOWN_GAPS` entry removed, including "the known-gap list SHRINKS".
4. `tsc --noEmit` clean project-wide.

### Blast radius

- `src/lib/largo/social-content-pack.ts` — the one file with the actual logic change.
- `src/lib/largo/social-content-pack.test.ts` — added mocks for its three async dependencies
  (`helixThermalCompareForLargo`, `zerodteRecordForLargo`, `zeroDtePlaysForLargo` — all stubbed to
  neutral/empty values, same `mock.module()` pattern as the sibling `pre-earnings-pack.test.ts`)
  and a new test pinning the anchor.
- `src/lib/largo/contract/session-anchor.test.ts` — removed the now-stale `KNOWN_GAPS` entry.
- The only real consumer, `src/lib/largo-terminal.ts` (`socialPack` is JSON-stringified wholesale
  into the Largo tool-use block), reads the object as an opaque payload with no exhaustive-shape
  assertion — the new field is additive and requires no change there. `ticker-social-guide.test.ts`
  and `desk-prompts.ts`'s `questionWantsSocialContentPack` are a separate, unrelated gate function
  and do not touch `SocialContentPack`'s shape.

### Fix rationale

Mirrors the Meridian timeline and polygon-news fixes on the same contract: add the ET anchor
beside the existing UTC instant rather than replacing it (`as_of` stays byte-for-byte the same
value/format every existing consumer already parses), compute both from one shared `nowMs` so
they can never drift apart across a calendar-day boundary, and use the shared, already-tested
`etSessionDate()` helper rather than hand-rolling ET date math again.
