> **kind:** FINDING

## Night Hawk Swings: play-brief resolution silently substitutes a WRONG, unrelated position when the requested positionId doesn't exist in that ticker's one remaining candidate — FIXED

**Status:** FIXED

### Root cause

Live repro, 2026-10-24 5-engine Ask Largo cycle: `bookContextSection`'s own rendered text on
`SWING:PANW:67`'s brief cites a sibling banger-origin position by its real id — "already holding
PANW LONG (separate, cross-engine position #2103)". That id is genuine: `loadOpenBook()`
(`play-brief-context.ts`) reads `banger_positions` live and finds a real, currently-open row with
that id on PANW. But `GET /api/market/swing/play-brief?playId=SWING:PANW:2103` does **not** serve
that position — it returns `playId: "SWING:PANW:67"`, a completely different, unrelated position
(different contract, different entry, different P&L), with no error and no indication the
requested id was never found.

Two call sites share the identical defect shape — a "this ticker has exactly one candidate, so it
must be the one asked about" shortcut that never checks whether a caller-supplied `positionId`
hint actually matches that sole candidate:

1. `pickLanePlayForBrief` (`play-brief-resolve-pure.ts`): `if (forTicker.length === 1) return
   forTicker[0]!;` ran before the function's own `hints.positionId` exact-match logic (which only
   exists further down, reached only when `forTicker.length > 1`).
2. `loadOpenTerminalPlay` (`play-brief-resolve.ts`): `if (!row && matches.length === 1) row =
   matches[0];` — same shape, against `swing_positions` rows.

The PANW#2103 banger-origin row is excluded from both functions' input arrays entirely —
`mergeBangerPositionsIntoSwingPlays` (`banger-lane-merge.ts`, deliberately, per its own test
"keeps canonical swing OPEN when banger also open on ticker") drops a banger row from board
display whenever a native swing position already manages that ticker, and `loadOpenTerminalPlay`
only ever queries `swing_positions` (banger lives in a separate table/id-space). So by the time
either function runs, PANW's ticker-filtered candidate list has exactly one entry — the *unrelated*
native position — and the stale/unmatched `positionId:2103` hint was silently discarded by the
single-candidate shortcut instead of being treated as "not found."

This is the same failure class play-brief-resolve.ts's own 2026-10-20 `closedFallback` fix already
named and fixed for a different trigger (a stale positionId past `loadClosedPlay`'s 90-day window):
"an explicit, unresolvable positionId must surface as absence, never as an unrelated substitute."
That fix's guard lived on a different fallback a few lines down and never covered these two
single-candidate shortcuts.

### Evidence

Live, reproducible (not a timing race — re-fetched `/horizons?view=swings` and the brief twice,
~2 minutes apart, both confirming the same state): PANW's `committed` list carries exactly one row
(`positionId: 67`), total committed count unchanged at 93 across both fetches. `GET
/api/market/swing/play-brief?playId=SWING:PANW:2103&expandIntel=1` returns HTTP 200 with
`"playId": "SWING:PANW:67"` and PANW:67's real entry/mark/P&L data — not an error, not a 404, not
the requested position.

### Fix

Added an identity guard to both single-candidate shortcuts: only take the "ticker has exactly one
candidate" shortcut when either no `positionId` hint was supplied, or the sole candidate's own id
actually matches it. Otherwise return `null`/leave the row unresolved, letting the caller's
existing fallback chain (already present and already handling exactly this "surface as absence"
case elsewhere in `resolveSwingPlayForBrief`) report the honest outcome instead.

### Blast radius

Two functions, one guard each, no other logic touched:
- `pickLanePlayForBrief` (`play-brief-resolve-pure.ts`) — guarded the `forTicker.length === 1`
  branch; the existing `forTicker.length > 1` exact-positionId-match logic a few lines below is
  unaffected and untouched.
- `loadOpenTerminalPlay` (`play-brief-resolve.ts`) — guarded the `matches.length === 1` branch;
  the positionId exact-match attempt immediately above it, and the strike/right/status fallbacks
  below it, are unaffected and untouched.

Checked both functions' existing test suites for any case relying on the old "blind single-
candidate substitution" behavior with a genuinely mismatched positionId hint — none exists; every
existing passing test either supplies no positionId, or supplies one that already matches its
sole/target row via the pre-existing exact-match paths.

### Fix rationale

Minimal, symmetric fix at the two sites that share the defect — not a redesign of either
resolution function, and not a change to `mergeBangerPositionsIntoSwingPlays`'s own (separately
intentional, tested) one-row-per-ticker display precedence. Deliberately did **not** attempt to
make the suppressed banger sibling independently browsable on the board (that is a genuine, real
product question — "should Engine B's own capital on a ticker the swing ledger also manages get
its own row/affordance somewhere" — worth raising with Cursor on the standing collaboration
thread, not a one-line correctness fix) — this fix only stops the resolver from silently lying
about *which* position a specific, explicit request actually returned.

### Tests

- RED: confirmed via `git stash` of only `play-brief-resolve-pure.ts` + `play-brief-resolve.ts` —
  the two new regression tests fail against the old code (both assert `null`, old code returned
  the unrelated PANW:67 play).
- GREEN: restored the fix — `src/lib/swing/play-brief-resolve.test.ts` 30/30 pass (3 new tests: the
  mismatch-must-return-null case, the no-hint-still-works case, and the matching-hint-still-works
  case, covering both `pickLanePlayForBrief` and `loadOpenTerminalPlay`).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/*.test.ts` — 2028/2028 pass.
- `npx tsx --experimental-test-module-mocks --test src/features/nighthawk/command-deck/*.test.ts` —
  458/458 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` — run and confirmed green before opening the PR.
