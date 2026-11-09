> **kind:** FINDING

## `new Date(String(r.col)).toISOString()` silently zeroes milliseconds on 32 db.ts row mappers — FIXED

**Status:** FIXED

### Root cause

`node-postgres` hands a `TIMESTAMPTZ` column back as a native JS `Date` (db.ts's own
`isoTimestampString` doc comment already documents this at length, for the `observed_at`/
`as_of`/etc. bug fixed in PR history and ratcheted by `db-iso-timestamp.test.ts`). That fix
introduced `isoTimestampString(value)`, which reads a `Date` object DIRECTLY
(`value.toISOString()`) so no precision is lost, and migrated several mappers to it.

32 *other* row mappers in `src/lib/db.ts` were never migrated. They instead used:

```ts
opened_at: new Date(String(r.opened_at)).toISOString(),
```

This is a second, distinct way to invoke `Date.prototype.toString()` on the same pg `Date`
object — `String(dateObj)` calls `.toString()`, which has **no sub-second field**
(`Date.prototype.toString()`'s format is `"Fri Aug 07 2026 17:31:36 GMT+0000 (...)"`, whole
seconds only). Re-parsing that string with `new Date(...)` and calling `.toISOString()`
produces a well-formed ISO 8601 string — so on a quick read this looks identical to the fixed
pattern — but the VALUE is wrong: milliseconds are unconditionally `.000`, regardless of what
the row actually carried.

Concretely:

```ts
new Date(String(new Date("2026-11-09T14:22:37.654Z"))).toISOString()
// => "2026-11-09T14:22:37.000Z"   (wrong — real value was .654)

isoTimestampString(new Date("2026-11-09T14:22:37.654Z"))
// => "2026-11-09T14:22:37.654Z"   (correct)
```

The existing regression-test guard (`db-iso-timestamp.test.ts`, "no db.ts row mapper still
coerces an instant column with a bare `String()`") only matched a BARE `String(r.col)`
coercion. It never matched this nested shape, so all 32 call sites slipped past it undetected.

### Evidence

Grepped `src/lib/db.ts` for the literal pattern `new Date(String(r.` before the fix: **32
matches**, spanning `mapPlayOutcomeRow` (feeds `GET /api/track-record/plays`, BIE calibration,
`ecosystem-context.ts`), `fetchOpenSpxPlay`, `fetchRecentSpxSignalLogs`, `mapUserJournalRow`,
`fetchLottoPlaysForDate`, `fetchNighthawkEditionByDate`/`fetchLatestNighthawkEdition`/
`fetchLatestPlayableNighthawkEdition`, `mapAlertAuditTrailRow`, `fetchUngradedAlertAuditRows`,
`mapZeroDteLogRow`, `mapSwingPositionRow`, `mapSwingSnapshotRow`, `mapSwingAccumRow`,
`fetchBieKnowledge`/`fetchBieKnowledgeStats`, `mapNighthawkPlayOutcomeRow`,
`fetchNighthawkPulledPlays`, `fetchNighthawkPublishGateRejections`, `mapNighthawkJobRow`.

Added a direct regression test reproducing the exact loss:

```ts
const withMs = new Date("2026-11-09T14:22:37.654Z");
new Date(String(withMs)).toISOString()      // "2026-11-09T14:22:37.000Z"  (pre-fix)
isoTimestampString(withMs)                   // "2026-11-09T14:22:37.654Z"  (post-fix)
```

RED→GREEN confirmed: stashing the `src/lib/db.ts` fix while keeping the new test reproduces a
failing assertion against the live (pre-fix) source; restoring the fix passes.

### Fix

Replaced all 32 occurrences of `new Date(String(r.col)).toISOString()` (bare) and
`r.col != null ? new Date(String(r.col)).toISOString() : null` (null-guarded) with
`isoTimestampString(r.col)!` / `isoTimestampString(r.col)` respectively — the exact same
helper the sibling fix already uses, which reads the `Date` object directly instead of its
lossy `.toString()`. One site (`fetchBieKnowledgeStats`'s `newest` reduction, a `.map()` over
`r.newest_at ? new Date(String(r.newest_at)).toISOString() : null`) used a slightly different
shape and was converted to `.map((r) => isoTimestampString(r.newest_at))` for the same reason.

No type signature changed except where the field's declared type was already nullable
(matched exactly, since `isoTimestampString` already returns `string | null`). Non-null fields
keep their declared `string` type via a `!` assertion — safe in practice because every touched
column is `NOT NULL` at the schema level, and strictly *safer* than before: the old pattern
would throw (`Invalid Date`) if the value were ever null/malformed, the new one returns `null`
instead of crashing the request.

### Blast radius

This is a single root cause (the same lossy `Date` → `String` → `Date` round-trip) duplicated
across 32 independent call sites in one shared file. All 32 were fixed in this PR rather than
just the one first noticed (`mapPlayOutcomeRow`), per this repo's "fix and note all of them"
blast-radius policy — the same policy that already produced the sibling
sign-bias-rounding sweep this session's prior rounds applied across `fmt-money.ts`/
`debrief.ts`/`round-floats.ts`/etc.

### Guard added

Extended `src/lib/db-iso-timestamp.test.ts` with:
1. A direct regression test pinning the exact millisecond-loss value.
2. A source-scan ratchet (`doesNotMatch(src, /new Date\(String\(r\.\w+\)\)\.toISOString\(\)/)`)
   so this exact anti-pattern — distinct from the bare-`String()` pattern the existing guard
   already covers — can never silently reappear at a new call site.
