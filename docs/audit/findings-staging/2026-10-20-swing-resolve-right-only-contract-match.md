## A swing play-brief identity resolver silently ignored a right-only (call/put) disambiguation hint — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit reading
`play-brief-resolve.ts` directly, targeting source not yet deep-audited this cycle, adversarially
verified (2-agent pipeline: investigation + independent skeptic re-trace against current source,
including a live, no-mocks repro via `npx tsx`; confirmed real).

**Root cause:** Both contract-matching helpers in this file's family short-circuited on `strike`
before ever examining `right`:

```ts
// play-brief-resolve-pure.ts — contractMatches (used by pickLanePlayForBrief)
function contractMatches(play: HorizonPlay, strike: number | null, right: "C" | "P" | null): boolean {
  if (strike == null) return true;   // <-- returns before `right` is ever checked
  if (play.contract.strike !== strike) return false;
  if (right == null) return true;
  return play.contract.right === right;
}
```
```ts
// play-brief-resolve.ts — rowContractMatches (used by loadOpenTerminalPlay)
function rowContractMatches(row: SwingPositionRow, strike: number | null, right: "C" | "P" | null): boolean {
  if (strike == null) return true;   // <-- same short-circuit
  ...
}
```

`strike` and `right` are documented as independent, optional disambiguation hints — the Largo tool
schema (`src/lib/largo/tool-defs.ts`'s `get_swing_play_brief`) defines them as separate optional
params and its own description says any subset of `positionId`/`strike`/`right`/`status` may be
supplied to disambiguate, explicitly including `right` alone. But both implementations treated
"strike present" as a precondition for even considering `right` — a caller asking only for "the put
position" on a ticker carrying both a live call and a live put matched **every** contract
regardless of side, then fell through to whichever tiebreak ran next (first match for the DB-row
path, live-status/highest-score for the lane-row path) — never the one actually requested.

This is the exact ticker/contract-collision identity class (Largo C4) this file's header and its
many 2026-09 fixes (NRG OPEN 110C vs WATCH 115C, ABTC 9C/9.5C, SG 9C/9.5C) were written to close —
except on `right` specifically, which none of those prior fixes tested. Every existing test in
`play-brief-resolve.test.ts` that passed `right` also passed `strike` in the same call, so the gap
was never exercised.

**Live impact:** reachable on any ticker carrying two live legs of opposite type (a call and a put
open/watched concurrently) when the Largo tool is asked to disambiguate by `right` alone — a
documented, supported call shape. Live-reproduced with real repo code (no mocks, `npx tsx`): a call
(strike 100, score 50) and a put (strike 90, score 90) on the same ticker, `pickLanePlayForBrief`
asked for `{right: "P"}` returned the **call**.

**Fix:** Both helpers now check `strike` and `right` independently — each disqualifies a candidate
only when it was actually supplied and doesn't match; neither can short-circuit past the other.

**Fix rationale:** Minimal, symmetric fix at both call sites — the two helpers are structurally
identical duplicates (one over `HorizonPlay`, one over `SwingPositionRow`), so the same correction
applies verbatim to both rather than inventing two different resolutions for one defect class. The
DB-row helper's existing fail-closed behavior for an unrecorded `contract_type` (added 2026-09-22)
is preserved exactly — only the ordering relative to the `strike` check changed.

**Blast radius:** Two call sites (`pickLanePlayForBrief` via `contractMatches`, `loadOpenTerminalPlay`
via `rowContractMatches`) — the only two functions in this file family that match on strike/right.
No other caller of either helper exists.

**Tests:** 3 new regression tests — `pickLanePlayForBrief` with a right-only hint (scores
deliberately favor the wrong leg so the old buggy score-tiebreak can't accidentally land on the
right answer); `loadOpenTerminalPlay` (DB-row path) with a right-only hint. RED→GREEN proven via
`git stash` (both new tests fail against the pre-fix source — the first attempt's fixture
accidentally passed on buggy code via a coincidental score tiebreak, corrected before trusting the
RED result). `tsc --noEmit` clean. Full `play-brief-resolve.test.ts` (23 tests) green.
