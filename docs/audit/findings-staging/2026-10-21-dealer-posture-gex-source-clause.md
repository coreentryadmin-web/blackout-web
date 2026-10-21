## 2026-10-21 — [FINDING, Night Hawk Swings / Ask Largo] `dealerPostureLine`'s GEX-substitution
"Last snapshot" bullet never named GEX as its data source, reading as a contradiction next to the
adjacent "Data caveat — Vector Ns stale" bullet in the same list — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings — Ask Largo swing play-brief, "Trade manager read" section |
| **File** | `src/lib/swing/play-brief-narrative.ts` (`dealerPostureLine`, return statement — was ~line 351 pre-fix) |
| **Severity** | P3 — every number rendered was individually correct; the defect was purely a missing source label that made the bullet read as internally contradictory |
| **Follow-up to** | PR #6437 (2026-10-21, same session, same function) — that PR fixed the AGE NUMBER this caption uses once Vector is stale and content is substituted from GEX; this PR fixes the remaining gap its own write-up named: the return value still never disclosed GEX as the source of that substituted content |

### Symptom (live repro, production `GET /api/market/swing/play-brief`, 2026-10-21)

"Trade manager read" section, two adjacent bullets with no source label distinguishing them:

- **TSLA:60** (positionId 60):
  `"• Data caveat — Vector 8642s stale. Treat levels as indicative until refresh."` immediately
  followed by
  `"• Last snapshot (~72s old) — spot 387.18 · dealers long gamma ..."`.
- **CRWV:63** (positionId 63):
  `"• Data caveat — Vector 9209s stale..."` followed by
  `"• Last snapshot (~23s old) — spot 61.20 · dealers short gamma ..."`.

Each number is individually correct (confirmed against the GEX matrix's own age directly) — the
defect is purely that nothing tells the reader these two bullets come from two different feeds, so
it reads as "Vector mysteriously refreshed from 8642s to 72s between two bullets in the same list."

### Root cause

`dealerPostureLine`'s `snapshotStale` branch (`vectorStale && !staleCheckExempt`) substitutes
Vector's stale read with GEX-matrix-sourced content — the prior same-session fix (PR #6437)
established, with a full proof in its own comment block, that whenever this branch is taken every
field the bullet renders (`posture`/`flip`/`fragileBit`/`regimeBit`/`netGexBit`/`sessionChangeBit`,
even `spot` itself) is GEX-sourced and GEX-fresh by construction, and captioned the bullet's AGE
with the GEX matrix's own age rather than Vector's. But the function's return statement still never
named GEX as the source of that content — unlike every sibling "Last snapshot" usage elsewhere in
the codebase (`src/lib/swing/play-brief-intel.ts`'s `gexPostureSection` at line 2734:
`` `**Last snapshot**${...} — dealer posture may lag spot.` ``, and `vectorDeskSection` at line 2916:
`` `**Last snapshot**${...} — Vector desk read may lag spot.` ``), which all append an explicit
disambiguating clause naming which feed the bullet's content came from. `dealerPostureLine` was the
one "Last snapshot" call site in the swing brief family missing this clause.

### Fix

Appended the same sibling-pattern disambiguating clause, reusing `gexPostureSection`'s own exact
wording (`" — dealer posture may lag spot"`, no new wording invented — this bullet's content is,
after all, the identical dealer-posture read `gexPostureSection` narrates from the same GEX matrix),
scoped to the `snapshotStale` branch only:

```ts
const sourceClauseBit = snapshotStale ? " — dealer posture may lag spot" : "";

return `${lead} — spot **${fmtPriceLevel(spot)}** · ${mechanic}${flipBit}${fragileBit}${regimeBit}${netGexBit}${sessionChangeBit}${sourceClauseBit}`;
```

The non-substituted (Vector-fresh, `"**Right now**"`) branch's wording is unchanged — `sourceClauseBit`
is only non-empty when `snapshotStale` is true, which is exactly the branch PR #6437 already proved
is GEX-sourced.

### Evidence (RED → GREEN, per repo policy)

- **RED:** `git stash push -u -m "<tag>" -- src/lib/swing/play-brief-narrative.ts` (source file
  only, test file untouched) reverted to the pre-fix return statement. The new regression test
  (`tradeManagerNarrativeSection: dealer-posture bullet names GEX as the source when substituting
  for stale Vector`) failed exactly as expected, reproducing the live TSLA shape verbatim:
  ```
  • Data caveat — Vector 8642s stale. Treat levels as indicative until refresh.
  • Last snapshot (~72s old) — spot 387.18 · dealers long gamma — dips tend to get bought, range/pin behavior
  AssertionError: the GEX-substitution branch must name GEX as the source, matching
  play-brief-intel.ts's established clause
  ```
- **GREEN:** `git stash apply <sha>` (not `pop`, per the shared-stash-stack convention) restored the
  fix; `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts`
  — 143/143 pass, Node 20.20.2.
- `npx tsc --noEmit` (full project) — clean, no new type errors.

### Blast radius

`dealerPostureLine` has exactly one call site (`tradeManagerNarrativeSection`, same file, line
~1458) and is not duplicated elsewhere in the codebase (confirmed by repo-wide grep for
`dealerPostureLine` — every other hit is a comment referencing this same function). No other call
site needed the same fix. The non-substituted (`"**Right now**"`) branch, and every other sibling
"Last snapshot" usage in `play-brief-intel.ts` (which already carried their own disambiguating
clauses), were deliberately left unchanged.
