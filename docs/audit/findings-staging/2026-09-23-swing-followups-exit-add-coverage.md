> **kind:** FINDING

## Situational followups (#5478) covered only Banger-lineage manage actions, missing native EXIT/ADD — FIXED

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings play-brief |
| **Severity** | P3 (product enhancement — coverage gap in a same-day enhancement, not a correctness regression) |
| **Status** | FIXED |
| **File** | `src/lib/swing/play-brief.ts` (`SITUATIONAL_FOLLOWUP_BY_MANAGE_ACTION`) |

### Root cause

Earlier the same day, PR #5478 added `SITUATIONAL_FOLLOWUP_BY_MANAGE_ACTION`, a lookup from
`play.manageAction` to a targeted followup chip. That first cut mapped only the three
`ScaleOutAction` values (`TAKE_PARTIAL`/`EXIT_RUNNER`/`STOP_OUT` — the Banger-lineage verdicts
computed by `deriveScaleOutAction`). But `SwingManageAction` (`manage.ts`) is
`ScaleOutAction | "EXIT" | "ADD"` — `EXIT` and `ADD` are the **native** `swing_positions` verdicts
(`live-plays.ts`'s `manageObservablesFromEvent`: `EXIT` on a broken/invalidated thesis, `ADD` as an
advisory add signal). Neither was in the map, so a native position with a broken thesis
(`manageAction: "EXIT"`) — arguably the state most worth a targeted followup — got nothing extra.

### Evidence

Found while spot-checking #5478's live deploy this cycle: sampling committed positions'
`manageAction` distribution showed native positions (NVDA, HUT, AAPL) reading `undefined`
manageAction while HOLD (expected, no chip needed either way), which prompted checking the full
`SwingManageAction` type rather than assuming the three `ScaleOutAction` values were exhaustive.
Reading `manage.ts:53`'s own type definition and doc comment confirmed `EXIT`/`ADD` are real,
distinct, meaningfully different verdicts the map didn't cover. No live position happened to be in
`EXIT`/`ADD` state at spot-check time, so this is a coverage gap found by reading the type, not a
live repro of a wrong answer — verified directly via unit test rather than inferred as fixed.

### Fix

Added `EXIT: "Why exit now?"` and `ADD: "Should I add to this?"` to the lookup map. Same additive
shape as the original fix — nothing else changes.

Regression tests added: EXIT and ADD manage actions each confirmed RED before the fix (generic five
chips only) / GREEN after (situational chip present), via `git stash`.

### Blast radius

Same single call site as #5478 (`followupsFor`). No other product surface reads this function.
