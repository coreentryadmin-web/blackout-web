> **kind:** FINDING

## Benzinga/Polygon news reader (`fetchTickerNews`/`fetchMarketCatalysts`) stamped a UTC instant with no Largo C1 ET session anchor — FIXED

**Status:** FIXED (regression test added, RED→GREEN proven).

### Root cause

`src/lib/providers/polygon-news.ts`'s `buildNewsResult()` stamped every `NewsResult` with
`asOf: new Date().toISOString()` and nothing else that resolves the ET trading session that
instant belongs to. This is exactly the defect class the Largo contract's C1 rule
(`src/lib/largo/contract/session-anchor.test.ts`) exists to ratchet out, documented in that
file's own header from three earlier real bugs (#2418, #2420, #2422): a bare UTC ISO instant is
unambiguous as a moment in time, but after ~20:00 ET the UTC *calendar date* is already tomorrow.
Any consumer resolving "today's" session off this stamp alone — whether a human reading a
dashboard field or a model doing date arithmetic over a tool result — reads a full session ahead
for roughly the last four hours of every RTH day.

This specific file was a listed, acknowledged `KNOWN_GAPS` entry in `session-anchor.test.ts`
("`src/lib/providers/polygon-news.ts`": "coordinator") since the ratchet's `ROOTS` was widened
from `["src/lib/largo","src/lib/bie"]` to `["src"]` on 2026-08-21 — a real gap waiting on an
owner, not an exemption on the merits (the test file's own docblock is explicit about this: "Each
is a real gap and a work item for its owning lane — NOT an exemption on the merits").

`NewsResult` (and the news it carries) feeds several downstream desks' catalyst/news evidence —
Night Hawk Cortex's `catalyst-news` source (`cortex/fetch.ts`), BIE's ecosystem context, and
Meridian's Benzinga earnings leg — any of which could misdate "most recent catalyst as of now" by
a session during the exact window (late RTH / after-hours) when a fresh catalyst print matters
most.

### Fix

Additive, matching the same pattern already used for the OHLC-bar case (`bar-session-date.ts`)
and the sibling Meridian timeline fix in PR #7593: add a `session_date: string | null` field to
`NewsResult`, derived from the *same* `Date.now()` instant `asOf` is built from (so the two can
never describe different moments), via the shared `etSessionDate()` helper
(`@/lib/largo/temporal/bar-session-date`). `asOf` is kept exactly as before — the fix never
removes the UTC instant, it only adds the anchor beside it.

Removed `src/lib/providers/polygon-news.ts` from `session-anchor.test.ts`'s `KNOWN_GAPS` map,
since it is now genuinely anchored (the ratchet's own "list SHRINKS" test enforces this isn't
left stale).

### Evidence (RED → GREEN)

1. **RED** — swapped in the original (pre-fix) `polygon-news.ts` from `origin/main` while keeping
   the new test assertions in `polygon-news.test.ts`:
   ```
   not ok 3 - buildNewsResult: computes newest from the freshest publishedAt + asOf present
     The input did not match the regular expression /^\d{4}-\d{2}-\d{2}$/. Input: ''
   not ok 4 - buildNewsResult: empty items → newest null, no unavailable unless set
     The input did not match the regular expression /^\d{4}-\d{2}-\d{2}$/. Input: ''
   # fail 2
   ```
   (`session_date` was simply `undefined` on the old shape, so `?? ""` fails the format check.)

2. **GREEN** — restored the fixed `polygon-news.ts`:
   ```
   # tests 5
   # pass 5
   # fail 0
   ```
   and the full `session-anchor.test.ts` ratchet (6 tests) passes, including "the known-gap list
   SHRINKS" now that the entry is removed.

3. Ran the consumer test suites that import `NewsResult`/mock these functions to confirm no
   downstream breakage from the additive field (all pre-existing mocks construct their own
   literal shapes and are untouched by this change):
   `src/lib/nighthawk/cortex/fetch.test.ts` (part of the combined 78-test run below),
   `src/lib/bie/ecosystem-context.test.ts`, `src/lib/swing/play-brief-intel.test.ts` (475 tests),
   `src/lib/swing/play-brief-absence.test.ts` — all green.

4. `tsc --noEmit` clean project-wide (test files are excluded from the tsconfig `include` glob
   per repo convention, so the mock literals in `*.test.ts` files that predate this field are
   unaffected either way).

### Blast radius

- `src/lib/providers/polygon-news.ts` — the one file with the actual logic change.
- `src/lib/providers/polygon-news.test.ts` — extended existing `buildNewsResult` assertions.
- `src/lib/largo/contract/session-anchor.test.ts` — removed the now-stale `KNOWN_GAPS` entry.
- No other file's logic was touched. Consumers (`nighthawk/cortex/fetch.ts`,
  `bie/ecosystem-context.ts`, `swing/swing-ingest.ts`, `swing/play-brief-intel.ts`/
  `play-brief-absence.ts`, `meridian/meridian-benzinga-earnings.ts`,
  `cron/swing-discovery/route.ts`) only read `NewsResult`/`NewsItem` as a type or call the
  exported functions; they gain the new field automatically with zero code change required on
  their side (purely additive, not a breaking change) and none of their own tests assert against
  an exhaustive/closed object shape that would now fail.

### Fix rationale

Mirrors the Meridian timeline fix on the same contract: add the ET anchor beside the existing UTC
instant rather than replacing it (`asOf` stays byte-for-byte the same value/format every existing
consumer already parses), compute both from one shared `nowMs` so they can never drift apart, and
use the shared, already-tested `etSessionDate()` helper rather than hand-rolling ET date math
again. Deliberately left `newest` (the freshest article's own `publishedAt`) unanchored — that
field already carries Benzinga's own timestamp as given and anchoring it is a separate, larger
question (what session does an *arbitrary upstream-provided* instant belong to) outside this
fix's scope.
