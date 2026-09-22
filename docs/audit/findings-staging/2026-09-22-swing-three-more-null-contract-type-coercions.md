> **kind:** FINDING

## Three more swing call sites fabricated a "call" direction for a never-recorded contract_type — FIXED

**Status:** FIXED (2026-09-22, Ask Largo × Night Hawk Swings standing mandate deep-dive — the
explicit follow-up sweep #5401's own finding doc flagged as worth doing)

### What was broken

#5401 fixed exactly this shape in `play-brief-roll-history.ts`'s roll-history narrative mapper,
but explicitly left three sibling call sites untouched, reasoning they carried "materially lower
real-world exposure" because each already short-circuits to null/no-match when
`contract_expiry`/`contract_strike` are missing. That reasoning does not actually cover the case:
a row can have a fully populated `contract_expiry`/`contract_strike` while `contract_type` alone
is null (they are three independent nullable columns, not one all-or-nothing write), so all three
sites remained genuinely reachable, not just theoretically so. Confirmed via grep across
`src/lib/swing/*.ts`: the identical `row.contract_type === "put" ? "P" : "C"` ternary appears in:

1. **`closed-plays.ts:96`** (`closedDeckSourceFromRow`) — maps a graded CLOSED position to its
   CLOSED-tab deck source. A null `contract_type` fabricated `"C"` into
   `SwingClosedDeckSource.contract.right`, shown directly in the CLOSED deck's contract label.
2. **`live-plays.ts:130`** (`contractFromRow`) — maps an OPEN/HOLD/TRIM position to its live
   `ChainContract`. A null `contract_type` fabricated `"C"` into the live position's `right`,
   feeding every live-brief render of that position (contract label, roll-history "from $X call"
   narrative, etc.).
3. **`play-brief-resolve.ts:143`** (`rowContractMatches`) — the WORSE of the three: this is not a
   display bug but an **identity-resolution bug**. The function exists specifically to fix
   ticker-collision misidentification (its own file header: "Fixes ticker-collision bugs (e.g.
   NRG OPEN 110C vs WATCH 115C)"). With the old ternary, a row whose real `contract_type` was
   never recorded silently reported `rowRight = "C"`, so a caller hint asking for a specific `"C"`
   leg would **falsely match** a row of genuinely unknown type — potentially resolving the brief
   to the WRONG position on a ticker with multiple live contracts, not merely mislabeling a known
   one.

`contract_type` is a genuinely nullable DB column (`db.ts`: `contract_type TEXT`, no `NOT NULL`;
`SwingPositionRow.contract_type: string | null`) — same root cause as #5401.

### Why this matters

Per `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence principle (C3): an invented value read by
the trader as measured fact is a contract violation. The `play-brief-resolve.ts` case additionally
touches C4 (identity) — resolving a brief to the wrong live position on a multi-contract ticker is
a materially worse failure than a mislabeled call/put, since the trader would be looking at the
wrong trade's data entirely.

### Fix

- `closed-plays.ts`: `closedDeckSourceFromRow` already returns `null` ("not reconstructible") for
  missing expiry/strike — an unrecognized/null `contract_type` now joins that same pattern
  (`if (row.contract_type !== "call" && row.contract_type !== "put") return null;`) instead of
  fabricating a right. Consistent with the function's own doc comment ("Null when not
  reconstructible").
- `live-plays.ts`: `contractFromRow` already returns `null` for missing expiry/strike — same
  treatment added for contract_type, so `livePlayFromSwingPosition` correctly omits the position
  from the live sections rather than showing a guessed direction.
- `play-brief-resolve.ts`: `rowContractMatches` now derives `rowRight` via a new shared pure
  helper, `rightFromContractType` (added to `play-brief-resolve-pure.ts`, which — per that file's
  own existing convention — carries no heavy imports, so it stays unit-testable without dragging
  in the server-only-guarded DB/Vector chain `play-brief-resolve.ts` itself pulls in). An
  unrecognized/null `contract_type` now maps to `null`, and the existing
  `if (right == null) return true` early-return means the null-vs-null case still correctly
  matches when the CALLER also has no right hint — only a caller with a specific `"C"`/`"P"` hint
  now correctly fails to match a row of unknown type, fail-closed instead of false-matching.

### Evidence (RED→GREEN, git-stash proven)

Stashed the three source fixes + the pure-helper addition (kept only the new tests): 4 new tests
failed —
- `closed-plays.test.ts`: "returns null (not a fabricated call) when contract_type was never
  recorded" — got `"C"`, expected `null`.
- `live-plays.test.ts`: "returns null (not a fabricated call) when contract_type was never
  recorded" — got a play with `contract.right === "C"`, expected `null` play.
- `play-brief-resolve.test.ts` × 2 (`rightFromContractType` null/unrecognized cases) — got `"C"`,
  expected `null`.

Restored the fix: same test files at 78/78 pass (0 fail), full suite run alongside this PR (see
PR body for exact count), `npx tsc --noEmit` clean.

### Blast radius

Four files touched: `closed-plays.ts`, `live-plays.ts`, `play-brief-resolve.ts`,
`play-brief-resolve-pure.ts` (new shared helper only — no behavior change to that file's existing
exports). No downstream consumer needed a type change: all three fixed functions already had a
`null`-returning "not reconstructible" escape hatch in their existing signature/contract, so this
fix uses existing honest-absence machinery rather than widening any type across the codebase.

### Not touched (deliberately)

`play-brief-roll-history.ts`'s own fix (#5401) is untouched — already correct. `commit.ts` and
`roll-plan.ts` (the only two writers of `contract_type`) both derive it from a real, already-known
chain-contract `right` at write time and were not touched — the gap is specifically in READERS
tolerating a null they can't have caused via the normal write path (legacy/backfilled rows, or any
future write path that doesn't set it), not in the writers themselves.
