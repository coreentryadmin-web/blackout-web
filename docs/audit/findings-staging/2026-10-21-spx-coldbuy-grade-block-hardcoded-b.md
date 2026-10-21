# SPX Slayer cold-BUY gate block message hardcodes "B setups" for every sub-A grade — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|

## Symptom

Live production repro, `GET /api/market/spx/play`, 2026-10-21: `confluence.grade` was `"C"`
(score 40), and `gates.blocks` contained the literal string:

```
Cold BUY requires grade A or better — B setups need WATCH→ENTRY
```

A reader sees a rule described as being about "B setups" when the play's actual, reported grade
is C — the message names a grade the play doesn't have.

## Root cause

`src/features/spx/lib/spx-play-gates.ts` (lines 351-352, pre-fix):

```ts
if (buyIntent && opts?.cold_buy_path && !stagingLab && gradeRank(confluence.grade) < gradeRank("A")) {
  blocks.push("Cold BUY requires grade A or better — B setups need WATCH→ENTRY");
}
```

The gate *condition* (`gradeRank(confluence.grade) < gradeRank("A")`) is true for ANY grade below
A — B, C, D, or F alike — but the *message* is a static string that only ever names "B setups".
The text was presumably written against the common case (a near-miss B-grade cold BUY) and never
updated to reflect that the same branch fires for every other sub-A grade too, so a C/D/F play
gets a message describing a grade it doesn't carry.

## Evidence

Live repro (production, 2026-10-21): `confluence.grade: "C"`, score 40, cold-BUY path attempted,
`gates.blocks` included the exact string quoted above — confirmed the hardcoded "B" ships to real
users regardless of actual grade.

Reproduced locally and proved RED → GREEN with `git stash` isolating only the source file
(`spx-play-gates.ts`; the test file, which already carried the new regression test, was never
touched by the stash):

- **RED** (pre-fix `spx-play-gates.ts`, new test's fixture: `grade: "C"`, `score: 40`,
  `cold_buy_path: true`): `gates.blocks` joined to
  `"... Cold BUY requires grade A or better — B setups need WATCH→ENTRY"` — assertion
  `/C setups need WATCH→ENTRY/` failed with `AssertionError` (actual message still said "B
  setups" on a grade-C play).
- **GREEN** (fix restored): same fixture now produces
  `"Cold BUY requires grade A or better — C setups need WATCH→ENTRY"` — full suite
  `src/features/spx/lib/spx-play-gates.test.ts` 26/26 pass (Node 20,
  `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-play-gates.test.ts`).
- `npx tsc --noEmit` clean on the whole project after the fix.

## Fix

Interpolate the play's real `confluence.grade` into the message instead of the hardcoded `"B"`:

```ts
blocks.push(`Cold BUY requires grade A or better — ${confluence.grade} setups need WATCH→ENTRY`);
```

### Deliberately left unchanged

- The gate *condition* itself (`gradeRank(confluence.grade) < gradeRank("A")`) is untouched — it
  was already correct; only the message text was wrong.
- The sibling score-floor message two lines above
  (`` `Cold BUY needs score ≥${playColdBuyMinScore()} (have ${abs})...` ``) already interpolates
  its own real values and needed no change — it's the pattern this fix brings the grade message
  in line with.
- The pre-existing test ("cold BUY path requires A-grade and min score", grade `"B"`) still
  passes unchanged, since "B setups" is simply the correct substitution when the real grade
  happens to be B.

## Blast radius

Grepped the repo for other hardcoded occurrences of this message (`"B setups"` /
`"Cold BUY requires"`) — the only other hits are: a test fixture string in
`spx-play-intel.test.ts` (a raw input array exercising `humanizeGateBlocks`'s dedup/passthrough
logic, unaffected either way since it only checks the message is passed through, not its exact
content) and `src/lib/largo/gate-rules.ts`'s doc comment (documents an unrelated gate — mixed-tape
threshold scaling — and does not reference this message). No other call site constructs this
specific block message, so this is the only fix site needed.
