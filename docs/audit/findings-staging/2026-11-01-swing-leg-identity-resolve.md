> **kind:** FINDING

## Night Hawk Swings "Ask Largo" play-brief resolved the WRONG leg of a rolled chain when asked for a specific position by its own id — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** standing Ask Largo × Night Hawk Swings ownership mandate, two independent live
audits, 2026-11-01, live-reproduced on 3/3 real rolled chains checked.

**Root cause:** `src/lib/swing/play-brief-resolve.ts`'s `loadClosedPlay(ticker, positionId)` looked
up the requested leg with:

```ts
const target =
  positionId != null
    ? graded.find((r) => r.id === positionId || r.root_position_id === positionId)
    : graded.sort((a, b) => String(b.graded_at).localeCompare(String(a.graded_at)))[0];
```

`graded` comes straight from `fetchSwingPositionsRange` (`src/lib/db.ts`:
`ORDER BY session_date DESC, id DESC`), so for a chain that rolled forward, the later/CHILD leg
sorts **before** the earlier leg it rolled from. `Array.prototype.find` returns on the first
element satisfying *either* disjunct, with no precedence between "this row's own id matches" and
"this row's `root_position_id` happens to match" — so when a caller asks for a specific leg by its
own real `positionId` (commonly the chain's root, which members/Largo reasonably bookmark), and a
*later* leg in the same chain carries that id as its `root_position_id`, `find()` can return and
serve that later, unrelated leg's entire outcome (P&L, `closedReason`, contract, dates) instead of
the exactly-requested leg's own data — silently swapping in a different trade's result under the
id the caller asked for.

The identical unsafe shape was independently duplicated in `loadOpenTerminalPlay`'s open-ledger
lookup (`matches.find((r) => r.id === hints.positionId || r.root_position_id === hints.positionId)`
— operates on the OPEN/HOLD/TRIM-only population, so the live collision is rarer there (a
rolled-forward parent leg is normally CLOSED/ROLLED, not still open), but the same exact-match-first
precedence is the only version of the check that is correct regardless of array order. The
sibling `resolveChainRootId` helper was checked and is **not** affected — it already does a plain
exact `r.id === positionId` match with no `root_position_id` OR-fallback, so it carries no
precedence ambiguity to begin with.

**Evidence — live-reproduced on 3/3 real production rolled chains** (requesting each chain's own
root `positionId`, 2026-11-01):
- **AMZN** root `positionId=44`: `/record` shows the real leg-44 outcome `exitPnlPct -27.67%`,
  `closedReason "stopped"`. `GET /api/market/swing/play-brief?playId=SWING:AMZN:44&ticker=AMZN&positionId=44&status=CLOSED`
  instead returned leg 48's data — `playId "SWING:AMZN:48"`, `+72.4%`, `"target"` — the **opposite**
  outcome; a documented loss reported as a win.
- **AAPL** root `positionId=37`: same pattern — leg 40's `+47.4%`/`"target"` served instead of leg
  37's own `-22.3%`/`"stopped"`.
- **INTC** root `positionId=30`: leg 35's `-33.2%`/`"stopped"` served instead of leg 30's own
  `-40.83%`/`"stopped"` — same sign this time, but still the wrong leg's data/date entirely.

**Fix:** check the exact `id` match across the whole array first, and only fall back to the
`root_position_id` match (the chain-root-bookmark case `resolveChainRootId`'s own doc comment
documents) when no exact match exists anywhere:

```ts
const target =
  positionId != null
    ? graded.find((r) => r.id === positionId) ?? graded.find((r) => r.root_position_id === positionId)
    : graded.sort((a, b) => String(b.graded_at).localeCompare(String(a.graded_at)))[0];
```

Applied identically in `loadOpenTerminalPlay`. Read-time lookup fix only — no DB write, no change
to `root_position_id`'s own semantics or to any other resolver branch in this file.

**Evidence (RED → GREEN):** added a regression test to `src/lib/swing/play-brief-resolve.test.ts`
constructing a fixture mirroring the live AAPL repro — a root leg (`id=37`, `-22.3%`, `"stopped"`)
and a rolled-forward child (`id=40`, `root_position_id=37`, `+47.4%`, `"target"`), deliberately
ordered **child-then-root** in the mocked `fetchSwingPositionsRange` result to mirror the real
`ORDER BY session_date DESC, id DESC` ordering. RED (pre-fix, verified by temporarily reverting only
the `loadClosedPlay` predicate back to the OR-with-no-precedence form, test file unchanged):
`resolveSwingPlayForBrief: an exact positionId match must win over a later leg whose
root_position_id happens to equal it (live AAPL repro) > requesting the EARLIER (root) leg's own id
resolves THAT leg's own outcome, not the later child's` failed —
`must resolve leg 37's OWN outcome (-22.3%, stopped), not leg 40's (+47.4%, target) — got exitPnlPct
47.4` (`AssertionError: 47.4 !== -22.3`), with the rest of the suite (42/43) still green, confirming
the test isolates exactly this bug. GREEN (post-fix): `npx tsx --experimental-test-module-mocks
--test play-brief-resolve.test.ts` → 43/43 pass. A second case in the same block
(requesting the child leg's own id, `positionId=40`) confirms the direct-id path is unchanged.
Also ran the 4 sibling test files that import this module
(`play-brief.test.ts`, `play-brief-roll-history.test.ts`, `serving-lane.test.ts`,
`play-brief-context.test.ts`) together with the new test: 285/285 pass. `npx tsc --noEmit`: clean.

**Blast radius:**
- `loadClosedPlay` is the shared function behind all four `positionId`-targeted closed-play lookups
  in `resolveSwingPlayForBrief` (the direct lookup, the chain-root-retry fallback, the
  `input.playId.includes("CLOSED")` fallback, and indirectly via `resolveChainRootId`'s own
  consumers) — fixing it once at the shared root fixes every call site; none of them duplicate the
  predicate themselves.
- `loadOpenTerminalPlay`'s open-ledger lookup duplicates the identical unsafe shape in a separate
  function operating on a different population (OPEN/HOLD/TRIM only) — fixed identically rather than
  left relying on the lower (but nonzero) probability of an open-side collision.
- `resolveChainRootId` checked and confirmed unaffected (exact match only, no OR-fallback).
- No other file in the repo reimplements this `id-or-root_position_id` lookup pattern
  (`grep -rn "root_position_id ===" src` finds only these two sites plus `resolveChainRootId`'s own
  unrelated exact-match line).

**Fix rationale:** `Array.prototype.find`'s first-match-wins semantics make an unordered OR of two
meaningfully different conditions (exact identity vs. a looser chain-membership fallback) load-
bearing on array order — which here is a real, documented DB `ORDER BY` that actively sorts the
wrong candidate first for a rolled chain. Splitting the lookup into two explicit, ordered `find()`
calls (exact id, then the fallback only if that misses) makes the precedence correct regardless of
how the input array happens to be sorted, with zero behavior change for the by-far-more-common case
where only one of the two conditions could ever match. Deliberately left `resolveChainRootId`
untouched since it was already correct, and left the DB query's own `ORDER BY` (and
`root_position_id`'s "sticky to the very first leg" semantics) alone — both are working as intended;
the bug was purely in how the resolver consumed an already-correctly-ordered/stamped result.
